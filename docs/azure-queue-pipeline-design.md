# Design Document: Azure Service Bus Queue Pipeline

**Feature:** Replace Vercel Cron-limited workers with Azure Service Bus + Azure Functions
**Branch:** `infra/azure-queue-pipeline`
**Status:** Design v1
**Authors:** Aishvarya Suhane

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Azure Resources](#4-azure-resources)
5. [Component Design](#5-component-design)
6. [Data Flow](#6-data-flow)
7. [Environment Variables](#7-environment-variables)
8. [Cost Analysis](#8-cost-analysis)
9. [Migration Strategy](#9-migration-strategy)
10. [Drawbacks & Concerns](#10-drawbacks--concerns)
11. [Out of Scope for MVP](#11-out-of-scope-for-mvp)

---

## 1. Problem Statement

The current pipeline is built entirely on Vercel Crons. On the Hobby plan, each cron path can run **at most once per day**, regardless of the schedule configured in `vercel.json`. This creates three hard throughput ceilings:

| Worker | Designed schedule | Hobby reality | Articles/day cap |
|--------|------------------|---------------|-----------------|
| `discover.js` | every 30 min | once/day | ~300 URLs discovered |
| `process.js` | every 5 min, batch 50 | once/day, batch 200 | **200 articles scraped** |
| `cluster.js` | 6:30 AM | once/day | limited (runs once on thin data) |
| `synthesize.js` | 6:45 AM | once/day | limited (runs once on thin clusters) |

Our RSS registry of 65+ feeds produces **1,500+ new article URLs per day**. With a 200-article ceiling on processing, 87% of the daily article inventory is never scraped. The Gold Set pipeline (cluster + synthesize) then runs once on that already-thin subset, compounding the quality loss.

**Quality impact chain:**
```
1,500 articles/day discovered
  → 200 scraped   (87% waste — process cron runs once)
    → ~30 clustered (150 low-quality articles fail quality gates)
      → ~8 stories synthesized (far below 20–50/day target)
        → quiz quality degrades: thin context, fewer verified stories
```

Upgrading to Vercel Pro restores the designed cron frequency but does not eliminate the per-invocation duration ceiling or the concurrency model. The correct fix is to move batch workers off Vercel Crons entirely and onto a proper message queue with auto-scaling consumers.

---

## 2. Root Cause Analysis

The Vercel Hobby plan imposes two distinct constraints that together cause the problem:

**Constraint 1 — Cron frequency:** Any path registered in `vercel.json` as a cron runs at most once per day on Hobby. `*/5 * * * *` is silently downgraded to `0 0 * * *`.

**Constraint 2 — Batch ceiling:** Even if frequency were restored, each invocation is a single synchronous Vercel Function call. We process up to 50 URLs per call. With `*/5 * * * *`, that is 50 × 288 = 14,400 URLs/day — more than enough. But at once/day: 200. There is no way to fan out work within a single Vercel Function call without hitting the `maxDuration` (300s) ceiling.

**Why not just upgrade Vercel?**
Pro plan restores cron frequency but still runs crons as Vercel Function invocations with no persistent workers. To truly drain a 1,500-article-per-day queue we need:
- A durable message queue (survives restarts, guarantees delivery)
- Auto-scaling consumers (process messages as fast as they arrive, not on a fixed schedule)
- At-least-once delivery semantics (built-in retry without manual retry_count logic)

Azure Service Bus + Azure Functions provides all three and fits within the existing $120/month Azure budget for approximately **$15/month** in new resources.

---

## 3. Proposed Architecture

### Overview

The pipeline splits into two tiers. Vercel retains what it is good at: serving HTTP API routes and light once-daily crons. Azure handles what Vercel Hobby cannot: continuous background processing with auto-scaling workers.

```
┌─────────────────────────────────────────────────────────────────┐
│  VERCEL (stays here)                                             │
│                                                                  │
│  GET /api/questions      — unchanged                             │
│  POST /api/complete      — unchanged                             │
│  GET /api/cron/generate  — 7:00 AM, once/day, unchanged         │
│  GET /api/cron/cleanup   — 3:00 AM, once/day, unchanged         │
│                                                                  │
│  GET /api/cron/discover  — MODIFIED: enqueues to Azure SB       │
│                            instead of writing to scrape_queue   │
└──────────────────────────────┬──────────────────────────────────┘
                               │  enqueue messages
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  AZURE SERVICE BUS (new)                                         │
│                                                                  │
│  Namespace: quydly-pipeline                                      │
│  Tier: Standard (required for queues)                            │
│                                                                  │
│  Queue: scrape-queue     maxDeliveryCount: 5, TTL: 7 days       │
│  Queue: cluster-queue    maxDeliveryCount: 3, TTL: 2 days       │
│  Queue: synthesize-queue maxDeliveryCount: 3, TTL: 2 days       │
└────────┬────────────┬────────────────────────┬──────────────────┘
         │            │                         │
         ▼            ▼                         ▼
┌────────────┐ ┌────────────────┐ ┌─────────────────────────────┐
│  article-  │ │   article-     │ │      story-synthesizer       │
│  scraper   │ │   clusterer    │ │                              │
│            │ │                │ │  Two-pass Claude API         │
│ Readability│ │ Entity extract │ │  confidence_score gate       │
│ → raw_     │ │ → clusters     │ │  story_score gate            │
│   articles │ │   (Supabase)   │ │  → stories (Supabase)       │
│            │ │                │ │                              │
│ AZURE FN   │ │ AZURE FN       │ │  AZURE FN                   │
│ SB Trigger │ │ Timer: 2h      │ │  SB Trigger                 │
└────────────┘ └────────────────┘ └─────────────────────────────┘
         │                │                        ▲
         │ on success     │ cluster eligible         │ enqueue
         │ enqueue        │ → enqueue                │
         └───────────────►│──────────────────────────┘
                          ▼
                   Supabase (unchanged)
                   raw_articles · clusters · stories
```

### Daily Cron Order After Migration

```
3:00 AM   cleanup     — Vercel Cron (once/day — unchanged)
~all day  discover    — Azure Timer Function (every 30 min) ← MOVED
~all day  scrape      — Azure Function, Service Bus trigger (continuous) ← NEW
~all day  cluster     — Azure Function, Service Bus trigger (continuous) ← NEW
~all day  synthesize  — Azure Function, Service Bus trigger (continuous) ← NEW
7:00 AM   generate    — Vercel Cron (once/day — unchanged)
```

Discovery, scraping, clustering, and synthesis all now happen throughout the day rather than in a single burst window.

---

## 4. Azure Resources

### 4.1 Resource Group

```
Name: quydly-pipeline-rg
Region: East US 2  (low latency to Supabase US-East, Anthropic API)
```

### 4.2 Azure Service Bus Namespace

```
Name:   quydly-pipeline
SKU:    Standard  (Basic does not support topics; Standard supports queues + dead-letter)
Region: same as resource group

Queues:
  scrape-queue
    maxDeliveryCount:       5       (5 delivery attempts before dead-letter)
    defaultMessageTTL:      7 days  (messages expire if not processed)
    lockDuration:           5 min   (worker has 5 min to complete or renew)
    enableDeadLetteringOnMessageExpiration: true

  cluster-queue
    maxDeliveryCount:       3
    defaultMessageTTL:      2 days  (clusters stale after 48h anyway)
    lockDuration:           2 min

  synthesize-queue
    maxDeliveryCount:       3
    defaultMessageTTL:      2 days
    lockDuration:           5 min   (Claude API calls can take 30–60s)
```

**Dead-letter queues** are automatically created by Azure Service Bus for each queue (`scrape-queue/$deadletterqueue`, etc.). These hold messages that exceeded `maxDeliveryCount` or expired. Inspect via Azure Portal or Azure CLI for debugging.

### 4.3 Azure Storage Account

```
Name:   quydlypipelinesa  (alphanumeric, 3-24 chars)
SKU:    Standard LRS
Required by Azure Functions runtime for host coordination and blob triggers.
```

### 4.4 Azure Function App

```
Name:    quydly-pipeline-fn
Runtime: Node.js 22 (LTS)
Plan:    Consumption (serverless, pay-per-execution)
Region:  same as namespace

Functions hosted here:
  - article-scraper      (Service Bus trigger: scrape-queue)
  - article-clusterer    (Timer trigger: every 2 hours)
  - story-synthesizer    (Service Bus trigger: synthesize-queue)
  - discover             (Timer trigger: every 30 min)  ← moved from Vercel
```

### 4.5 Application Insights

```
Name: quydly-pipeline-insights
Connected to: quydly-pipeline-fn
Purpose: structured logs, invocation traces, dead-letter alerts
```

---

## 5. Component Design

### 5.1 `discover` — Azure Timer Function (every 30 min)

**Moved from Vercel.** Logic is identical to the existing `api/cron/discover.js` with one change: instead of `INSERT INTO scrape_queue`, it sends messages to Azure Service Bus.

```
Trigger: TimerTrigger — "0 */30 * * * *"  (every 30 min, Azure cron syntax)

Algorithm:
  1. Fetch all RSS feeds: Promise.allSettled in batches of 10
  2. For each item in each feed:
     a. canonicaliseUrl(item.link) → canonical_url
     b. url_hash = SHA256(canonical_url)
     c. CHECK if url_hash exists in scrape_queue (Supabase)
        → SELECT 1 FROM scrape_queue WHERE url_hash = $hash LIMIT 1
     d. If new:
        i.  INSERT INTO scrape_queue (status='QUEUED', ...) ON CONFLICT DO NOTHING
            — record metadata immediately; Service Bus is the work queue
        ii. Send message to scrape-queue:
            {
              url_hash, canonical_url, raw_url, title, summary,
              source_domain, category_id, authority_score, published_at
            }
     e. If known: skip (already queued or processed)
  3. Log: { feeds_attempted, feeds_ok, feeds_failed, urls_queued, urls_skipped }

Error handling: same as existing discover.js — per-feed isolation, no batch abort
```

**Why move discovery to Azure?**
On Vercel Hobby, `*/30 * * * *` is silently reduced to once/day. Moving it to Azure restores the intended frequency and ensures we discover articles throughout the day, not just once.

**`scrape_queue` table role after migration:**
- Written at discovery time (status=QUEUED) — preserved for audit and reprocessing
- Updated by article-scraper (status=PROCESSING / DONE / PARTIAL / FAILED)
- No longer read by a Vercel cron worker
- Service Bus `scrape-queue` is the actual work trigger; `scrape_queue` is the audit log

---

### 5.2 `article-scraper` — Azure Function (Service Bus Trigger)

Replaces the Vercel `api/cron/process.js` cron. Triggered per message — no batching required.

```
Trigger: ServiceBusTrigger on "scrape-queue"
         maxConcurrentCalls: 16  (16 parallel scrapes per function instance)
         Azure Functions Consumption scales instances to demand

Input message (JSON):
  { url_hash, canonical_url, source_domain, category_id, authority_score,
    published_at, title, summary }

Algorithm:
  1. UPDATE scrape_queue SET status = 'PROCESSING' WHERE url_hash = $url_hash

  2. Fetch article:
       fetch(canonical_url, {
         signal: AbortSignal.timeout(9000),
         headers: { 'User-Agent': 'QuydlyBot/1.0 (+https://quydly.com/bot)' }
       })

  3. Parse with jsdom + @mozilla/readability:
       const dom = new JSDOM(html, { url: canonical_url })
       const article = new Readability(dom.window.document).parse()

  4. cleaned = article?.textContent?.trim() ?? null
     content_hash = cleaned ? SHA256(cleaned) : null
     final_status = determine (DONE / PARTIAL / LOW_QUALITY)

  5. INSERT INTO raw_articles (..., is_verified=false) ON CONFLICT (url_hash) DO NOTHING

  6. UPDATE scrape_queue SET status = final_status, processed_at = now()

  7. On DONE: send message to cluster-queue:
       { article_id, category_id, url_hash }
     On PARTIAL/LOW_QUALITY: do not enqueue to cluster-queue
     (partial articles may still cluster via the article-clusterer timer pass)

Error handling:
  - Network/parse error: throw — Service Bus retries automatically (up to maxDeliveryCount=5)
  - After 5 delivery attempts: message moves to dead-letter queue
  - DB error: throw — same retry behavior
  - Do NOT catch errors silently — let Service Bus own the retry budget
```

**Key difference from Vercel process.js:**
- No manual `retry_count` management — Service Bus handles delivery attempts
- No `SELECT ... FOR UPDATE SKIP LOCKED` batch query — each message is independently locked
- No per-domain concurrency cap needed at the function level — Azure Functions scales instances; per-domain rate limiting can be added via a simple in-memory counter if needed

---

### 5.3 `article-clusterer` — Azure Timer Function (every 2 hours)

Replaces the Vercel `api/cron/cluster.js` cron. Runs every 2 hours instead of once at 6:30 AM.

```
Trigger: TimerTrigger — "0 0 */2 * * *"  (every 2 hours)

Algorithm:
  Identical to existing clusterer.js with two changes:

  Change 1 — Article window:
    Instead of: ingested_at > NOW() - INTERVAL '12 hours'
    Use:        clustered_at IS NULL OR clustered_at < NOW() - INTERVAL '2 hours'
    Requires:   new column raw_articles.clustered_at (nullable timestamptz)
    Set to NOW() after an article is assigned to any cluster.
    This prevents re-processing the same article every 2h.

  Change 2 — After cluster is updated/created:
    If cluster becomes newly eligible (cluster_score ≥ 20 AND article_ids.length ≥ 2
    AND unique_domains.length ≥ 2):
      Send message to synthesize-queue: { cluster_id, category_id }
      Mark cluster.synthesis_queued_at = NOW() to prevent duplicate messages

Output: { articles_processed, clusters_updated, clusters_created, clusters_eligible }
```

**New column on `raw_articles`:**
```sql
ALTER TABLE raw_articles ADD COLUMN clustered_at timestamptz;
CREATE INDEX idx_raw_articles_unprocessed ON raw_articles (ingested_at)
  WHERE clustered_at IS NULL AND status = 'DONE';
```

**New column on `clusters`:**
```sql
ALTER TABLE clusters ADD COLUMN synthesis_queued_at timestamptz;
```

---

### 5.4 `story-synthesizer` — Azure Function (Service Bus Trigger)

Replaces the Vercel `api/cron/synthesize.js` cron. Triggered when a cluster becomes eligible.

```
Trigger: ServiceBusTrigger on "synthesize-queue"
         maxConcurrentCalls: 3  (Claude API rate limit — same as existing synthesizer)

Input message (JSON):
  { cluster_id, category_id }

Algorithm:
  Identical to existing synthesizer.js — no changes to Claude prompts, scoring,
  River model upsert, or quality gates.

  Only change: entry point is a Service Bus message, not a SELECT of PENDING clusters.
  The cluster_id is known from the message — fetch it directly:
    SELECT * FROM clusters WHERE id = $cluster_id AND status = 'PENDING'
  If not found (already processed by a duplicate message): complete message, return.

Error handling:
  - Claude API error: throw — Service Bus retries up to maxDeliveryCount=3
  - After 3 attempts: dead-letter with cluster_id for manual inspection
  - DB error: throw — same retry
  - Exponential backoff between retries: Azure Service Bus handles this via
    lockDuration release (message reappears after lock expires, 5 min)
```

---

### 5.5 Vercel `api/cron/discover.js` — Removed (moved to Azure)

The existing Vercel cron handler is deleted after the Azure Timer Function is deployed and validated.

```
Removed: api/cron/discover.js
Removed: /api/cron/process.js
Removed: /api/cron/cluster.js
Removed: /api/cron/synthesize.js

Unchanged in vercel.json:
  /api/cron/generate   — 0 7 * * *
  /api/cron/cleanup    — 0 3 * * *
```

---

## 6. Data Flow

### 6.1 Article Scraping (Revised)

```
Every 30 min:
  Azure Timer Function: discover
    ├─ parse 65+ RSS feeds
    ├─ canonicalise + deduplicate URLs
    ├─ INSERT into scrape_queue (status=QUEUED)
    └─ send N messages → Azure Service Bus: scrape-queue

Continuously:
  Azure Function: article-scraper (triggered by each message)
    ├─ fetch + Readability parse
    ├─ INSERT into raw_articles (is_verified=false)
    ├─ UPDATE scrape_queue status = DONE|PARTIAL|FAILED
    └─ send message → Azure Service Bus: cluster-queue (if DONE)

Result: all 1,500+ daily articles processed within 30–60 min of discovery
```

### 6.2 Gold Set Pipeline (Revised)

```
Continuously (after article scraping):
  Azure Function: article-clusterer (Timer, every 2 hours)
    ├─ SELECT unclustered raw_articles (clustered_at IS NULL)
    ├─ entity extraction + cluster matching
    ├─ UPDATE raw_articles SET clustered_at = NOW()
    ├─ UPDATE/INSERT clusters
    └─ send message → Azure Service Bus: synthesize-queue (if cluster eligible)

Continuously (after clustering):
  Azure Function: story-synthesizer (triggered by each message)
    ├─ fetch cluster + article content
    ├─ Pass 1: Claude fact extraction
    ├─ Pass 2: Claude narrative generation
    ├─ computeStoryScore → quality gate
    └─ upsert into stories (River model)

Result: 20–50 stories available before 7 AM generate cron
        Stories update continuously as new articles arrive throughout the day
```

### 6.3 Complete Daily Timeline (Target)

```
Midnight–7AM:
  30-min: discover → scrape-queue messages enqueued
  Continuous: article-scraper drains scrape-queue
  Every 2h: article-clusterer runs on newly scraped articles
  Continuous: story-synthesizer drains synthesize-queue

7:00 AM:
  generate cron reads from stories (as planned, future wiring)
  OR reads from raw_articles (current behaviour — unchanged)
```

---

## 7. Environment Variables

### Added to Azure Function App settings

```
# Supabase (same values as existing Vercel env)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # use service role — Azure Functions are server-side

# Redis (same values)
REDIS_URL=

# Anthropic (same values)
ANTHROPIC_API_KEY=

# Azure Service Bus (new)
AZURE_SERVICE_BUS_CONNECTION_STRING=
# Full connection string from Azure Portal: Shared access policy → RootManageSharedAccessKey

# RSS feeds config (referenced by discover function)
# No extra env var — uses config/rss-feeds.js bundled into the function package

# Optional: Vercel webhook (so Azure can call Vercel generate if needed — not required)
```

### Added to Vercel env (for discover.js during transition period)

```
AZURE_SERVICE_BUS_CONNECTION_STRING=   # same value — Vercel discover.js enqueues during cutover
```

### Removed from Vercel env (after cutover)

```
# None removed — ANTHROPIC_API_KEY and SUPABASE keys are still used by generate cron
```

---

## 8. Cost Analysis

### Azure Service Bus (Standard tier)

```
Namespace: $10/month flat
Operations: 1,500 articles/day × 3 queues (scrape/cluster/synthesize)
            = 4,500 operations/day = ~135,000/month
            First 10M operations/month: included in Standard flat fee
Cost: $10/month
```

### Azure Functions (Consumption Plan)

```
Free grant: 1,000,000 executions/month + 400,000 GB-s compute
Article scraper: 1,500 invocations/day × 30 days = 45,000/month  → free tier
Clusterer: 12 timer runs/day × 30 = 360/month                    → free tier
Synthesizer: ~50 stories/day × 30 = 1,500/month                  → free tier
Total executions: ~47,000/month — well within 1M free grant
Cost: $0/month (within free tier)
```

### Azure Storage Account (required by Functions)

```
LRS, minimal usage (runtime state only): ~$1/month
```

### Application Insights

```
5 GB free data ingestion/month. Pipeline logs are lightweight JSON: ~$0/month
```

### Summary

| Resource | Monthly cost |
|---------|-------------|
| Service Bus Standard | $10 |
| Function App (Consumption) | $0 (free tier) |
| Storage Account | $1 |
| Application Insights | $0 |
| **Total** | **~$11/month** |

Well within the $120/month Azure budget. ~$109/month remains for other Azure resources.

---

## 9. Migration Strategy

### Phase 0: Pre-migration (no user impact)

Deploy Azure resources. Azure Functions are idle — no Vercel crons are changed yet.

### Phase 1: Parallel run (shadow mode)

1. Deploy Azure discover timer + article-scraper function
2. Keep existing Vercel `api/cron/discover` and `api/cron/process` running
3. Azure functions run independently — both pipelines write to the same `scrape_queue` and `raw_articles` tables
4. `ON CONFLICT DO NOTHING` on both insert paths prevents duplicates
5. Monitor: compare scrape counts from Vercel vs Azure after 24h
   - Vercel: ~200 articles/day
   - Azure: should reach 1,000–1,500 articles/day

### Phase 2: Vercel process cron cutover

1. Remove `api/cron/process.js` and its `vercel.json` entry
2. Azure article-scraper is now the sole scraping worker
3. Verify: `raw_articles` count growing through the day, not just at process cron time

### Phase 3: Clusterer + synthesizer cutover

1. Deploy Azure article-clusterer (timer) + story-synthesizer (Service Bus trigger)
2. Run parallel with Vercel cluster + synthesize crons for 2 days
3. Verify: `clusters` and `stories` tables fill correctly
4. Remove Vercel `api/cron/cluster.js` and `api/cron/synthesize.js`

### Phase 4: Discovery cutover

1. Deploy Azure discover timer function
2. Run parallel with Vercel discover cron for 24h
3. Both discover functions hit the same `scrape_queue` dedup — no double-processing
4. Remove Vercel `api/cron/discover.js` and its `vercel.json` entry

### Rollback at any phase

- Phase 1–2: re-add `api/cron/process` to `vercel.json` → Vercel cron restores immediately
- Phase 3: re-add cluster + synthesize crons → same
- Phase 4: re-add discover cron → same
- Azure Functions can be disabled per-function in Azure Portal without deleting anything

---

## 10. Drawbacks & Concerns

### 10.1 Two Runtimes to Maintain

**Problem:** Backend code now lives in both Vercel (API routes, generate cron) and Azure (pipeline workers). Two deployment targets, two sets of env vars, two monitoring tools.

**Mitigation:**
- Both runtimes run Node.js — shared utility modules (`nlp.js`, `scoring.js`, `canonicalise.js`) can be imported from a shared path or published as a local package
- Azure Functions are thin workers — most logic stays in `backend/engine/` and `backend/services/`, unchanged
- Keep Azure Function App code in a new top-level directory `azure-functions/` in the same repo

### 10.2 Clustering Race Conditions

**Problem:** The article-clusterer timer runs every 2 hours. If two timer invocations overlap (unlikely but possible with long runs), two workers might assign the same article to different clusters.

**Mitigation:**
- `raw_articles.clustered_at`: once set by the first worker, the article is skipped by subsequent runs
- `SELECT ... WHERE clustered_at IS NULL` combined with an atomic `UPDATE ... RETURNING` pattern prevents double-processing
- Azure Timer Functions on Consumption plan do not run concurrent instances by default

### 10.3 Synthesizer Duplicate Triggering

**Problem:** If a cluster receives two new articles in the same 2-hour window, article-clusterer may enqueue the cluster to `synthesize-queue` twice (once when it first became eligible, once when the second article was appended).

**Mitigation:**
- `clusters.synthesis_queued_at`: before enqueuing, check if `synthesis_queued_at > NOW() - INTERVAL '2 hours'` — if so, skip
- story-synthesizer: on receiving a cluster_id, SELECT the cluster fresh from DB. If already PROCESSED within the last 2 hours, complete the message and return (idempotent)

### 10.4 Service Bus Connection String in Vercel (Transition Only)

**Problem:** During Phase 1 (parallel run), Vercel's discover cron needs the Service Bus connection string to enqueue. This is an Azure credential in Vercel env.

**Mitigation:**
- Use a SAS policy with `Send` permission only (not `Manage`) — minimal privilege
- Remove from Vercel env after Phase 4 cutover

### 10.5 Dead-Letter Queue Monitoring

**Problem:** Failed messages accumulate in dead-letter queues silently unless monitored.

**Mitigation:**
- Azure Monitor alert: dead-letter message count > 0 → email alert to `aishvar.suhane@gmail.com`
- Weekly manual review via Azure Portal or `az servicebus queue show`

---

## 11. Out of Scope for MVP

| Feature | Rationale for deferral |
|---------|----------------------|
| Azure API Management | Not needed — Azure Functions are internal workers, not public endpoints |
| Azure Event Grid (topics/subscriptions) | Service Bus queues are sufficient; topics add complexity for no benefit at this scale |
| Per-domain rate limiting in article-scraper | maxConcurrentCalls=16 is already gentle; per-domain cap can be added if any domain returns 429 |
| Azure Key Vault | Env vars in Function App settings are sufficient; Key Vault adds complexity |
| Bicep / Terraform IaC | Manual Azure Portal setup for MVP; IaC is a v2 concern |
| VNet integration | Not required — Supabase and Anthropic are public endpoints |
| Separate staging Function App | Use a naming convention (quydly-pipeline-fn-staging) if needed; not required for MVP |

---

## Summary

| Dimension | Current (Vercel Hobby) | After Azure Migration |
|-----------|------------------------|----------------------|
| Discovery frequency | Once/day (Hobby limit) | Every 30 min (Azure Timer) |
| Articles scraped/day | ~200 | 1,500+ (Azure SB trigger, continuous) |
| Clustering frequency | Once/day at 6:30 AM | Every 2 hours (Azure Timer) |
| Synthesis frequency | Once/day at 6:45 AM | Continuous (Azure SB trigger) |
| Stories/day | ~8 (estimated) | 20–50 (target met) |
| Dead-letter handling | Manual `retry_count` in DB | Azure Service Bus DLQ |
| New monthly cost | $0 | ~$11/month |
| Vercel crons retained | 4 | 2 (generate + cleanup) |
| New Azure resources | 0 | 1 resource group, 1 SB namespace, 3 queues, 1 function app, 1 storage account |

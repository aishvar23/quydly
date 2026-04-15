# Design Document: Azure Service Bus Queue Pipeline

**Feature:** Replace Vercel Cron-limited workers with Azure Service Bus + Azure Functions
**Branch:** `infra/azure-queue-pipeline`
**Status:** Design v2 — review fixes incorporated
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
8. [Authentication Model](#8-authentication-model)
9. [Cost Analysis](#9-cost-analysis)
10. [Migration Strategy](#10-migration-strategy)
11. [Drawbacks & Concerns](#11-drawbacks--concerns)
12. [Out of Scope for MVP](#12-out-of-scope-for-mvp)

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

Azure Service Bus + Azure Functions provides all three and fits within the existing $120/month Azure budget for approximately **$11/month** in new resources.

---

## 3. Proposed Architecture

### 3.1 Steady State (target after full migration)

Vercel retains HTTP API routes and the two once-daily crons (generate + cleanup). All background pipeline workers move to Azure.

```
┌─────────────────────────────────────────────────────────────────┐
│  VERCEL (retained)                                               │
│                                                                  │
│  GET /api/questions      — unchanged                             │
│  POST /api/complete      — unchanged                             │
│  GET /api/cron/generate  — 7:00 AM, once/day, unchanged         │
│  GET /api/cron/cleanup   — 3:00 AM, once/day, unchanged         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  AZURE FUNCTION APP: quydly-pipeline-fn                          │
│                                                                  │
│  discover        Timer, every 30 min                             │
│  article-scraper Service Bus trigger: scrape-queue               │
│  article-clusterer Timer, every 2 hours                          │
│  story-synthesizer Service Bus trigger: synthesize-queue         │
└──────────────────┬──────────────────────────────┬───────────────┘
                   │ enqueue                       │ enqueue
                   ▼                               ▼
┌──────────────────────────────────┐   ┌──────────────────────────┐
│  scrape-queue                    │   │  synthesize-queue         │
│  maxDelivery: 5 · TTL: 7d        │   │  maxDelivery: 3 · TTL: 2d│
└──────────────────────────────────┘   └──────────────────────────┘
         │ triggers                              │ triggers
         ▼                                       ▼
┌────────────────────┐              ┌────────────────────────────┐
│  article-scraper   │              │  story-synthesizer          │
│  fetch + parse     │              │  two-pass Claude API        │
│  → raw_articles    │              │  → stories (Supabase)       │
│  per-domain cap:   │              │  maxConcurrentCalls: 3      │
│  2 via Redis       │              └────────────────────────────┘
└────────────────────┘
         │ DONE articles accumulate in raw_articles
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│  article-clusterer  (Timer, every 2 hours)                      │
│  SELECT raw_articles WHERE clustered_at IS NULL AND status=DONE │
│  entity extraction + cluster matching → clusters (Supabase)     │
│  UPDATE raw_articles SET clustered_at = NOW()                   │
│  if cluster eligible: → synthesize-queue                        │
└────────────────────────────────────────────────────────────────┘
                   │
                   ▼
          Supabase (unchanged)
          raw_articles · clusters · stories
```

**Queue inventory in steady state: 2 queues only**

| Queue | Producer | Consumer |
|-------|----------|----------|
| `scrape-queue` | discover (Azure Timer) | article-scraper (Azure SB trigger) |
| `synthesize-queue` | article-clusterer (Azure Timer) | story-synthesizer (Azure SB trigger) |

There is no `cluster-queue`. Article clustering is timer-driven (every 2 hours), polling for unclustered articles via `WHERE clustered_at IS NULL`. A message queue for per-article clustering would introduce race conditions where two concurrently processed messages for the same topic create duplicate clusters instead of merging. The timer-batch model avoids this without coordination overhead.

**Vercel crons removed after full migration:**
```
api/cron/discover.js    ← Azure Timer Function takes over
api/cron/process.js     ← article-scraper Service Bus Function
api/cron/cluster.js     ← article-clusterer Timer Function
api/cron/synthesize.js  ← story-synthesizer Service Bus Function
```

**Vercel crons retained:**
```
api/cron/generate  — 0 7 * * *
api/cron/cleanup   — 0 3 * * *
```

---

### 3.2 Migration Architecture (temporary, removed after cutover)

During migration, Vercel and Azure workers run in parallel. All DB operations are idempotent (`ON CONFLICT DO NOTHING`), so both systems can safely write to the same tables simultaneously.

```
Phase A — parallel scraping (both Vercel + Azure active):
  Vercel discover (once/day, Hobby) + Azure discover (every 30 min)
    → both write to scrape_queue (audit) + send to scrape-queue (Azure SB)
  Vercel process.js (once/day) + Azure article-scraper (continuous)
    → both insert into raw_articles ON CONFLICT DO NOTHING
  Compare counts after 24h — Azure should show 5–8× more articles

Phase B — parallel clustering + synthesis:
  Vercel cluster.js (once/day) + Azure article-clusterer (every 2h)
  Vercel synthesize.js (once/day) + Azure story-synthesizer (continuous)
  Verify stories quality and volume

Phase C — cutover:
  Remove Vercel process/cluster/synthesize/discover crons from vercel.json
  Azure is now sole producer + consumer
```

Vercel `api/cron/discover.js` in migration phase needs `AZURE_SERVICE_BUS_CONNECTION_STRING` added to Vercel env to send shadow messages to Service Bus. This credential is removed from Vercel after Phase C.

---

### 3.3 Daily Timeline (Steady State Target)

```
3:00 AM   cleanup       — Vercel Cron (once/day)
Continuous: discover    — Azure Timer (every 30 min) → scrape-queue
Continuous: scraping    — article-scraper drains scrape-queue
Every 2h: clustering    — article-clusterer clusters DONE articles → synthesize-queue
Continuous: synthesis   — story-synthesizer drains synthesize-queue
7:00 AM   generate      — Vercel Cron (once/day, unchanged)
```

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
SKU:    Standard  (Basic does not support dead-letter queues)
Region: same as resource group

Queues:
  scrape-queue
    maxDeliveryCount:       5       (5 attempts before dead-letter)
    defaultMessageTTL:      7 days
    lockDuration:           5 min   (worker has 5 min to complete or renew)
    enableDeadLetteringOnMessageExpiration: true

  synthesize-queue
    maxDeliveryCount:       3
    defaultMessageTTL:      2 days
    lockDuration:           5 min   (Claude API calls can take 30–60s)
```

Dead-letter queues are created automatically: `scrape-queue/$deadletterqueue`, `synthesize-queue/$deadletterqueue`.

### 4.3 Azure Storage Account

```
Name:   quydlypipelinesa
SKU:    Standard LRS
Required by Azure Functions runtime.
```

### 4.4 Azure Function App

```
Name:    quydly-pipeline-fn
Runtime: Node.js 22 (LTS)
Plan:    Consumption (serverless, pay-per-execution)
Region:  same as namespace
Identity: System-assigned Managed Identity (enabled at creation)

Functions:
  discover          TimerTrigger — "0 */30 * * * *"
  article-scraper   ServiceBusTrigger — scrape-queue
  article-clusterer TimerTrigger — "0 0 */2 * * *"
  story-synthesizer ServiceBusTrigger — synthesize-queue
```

### 4.5 Application Insights

```
Name: quydly-pipeline-insights
Connected to: quydly-pipeline-fn
Purpose: invocation logs, dead-letter alerts
```

---

## 5. Component Design

### 5.1 `discover` — Azure Timer Function (every 30 min)

Moved from Vercel. Logic identical to existing `api/cron/discover.js`, with Service Bus replacing direct Supabase queue writes.

```
Trigger: TimerTrigger — "0 */30 * * * *"

Algorithm:
  1. Fetch all RSS feeds: Promise.allSettled in batches of 10
  2. For each item in each feed:
     a. canonicaliseUrl(item.link) → canonical_url
     b. url_hash = SHA256(canonical_url)
     c. SELECT 1 FROM scrape_queue WHERE url_hash = $hash LIMIT 1
     d. If new:
        i.  INSERT INTO scrape_queue (status='QUEUED', ...) ON CONFLICT DO NOTHING
            — audit record written immediately
        ii. Send message to scrape-queue:
              { url_hash, canonical_url, raw_url, title, summary,
                source_domain, category_id, authority_score, published_at }
     e. If known: skip
  3. Log structured metrics (event: "discover_run")

Error handling: per-feed isolation — one broken feed never stops the run
```

**`scrape_queue` table role:** written at discovery time (audit). Updated by article-scraper with final status. Service Bus is the work trigger; the table is the audit log and reprocessing surface.

---

### 5.2 `article-scraper` — Azure Function (Service Bus Trigger)

Replaces `api/cron/process.js`. Triggered per message.

```
Trigger: ServiceBusTrigger — scrape-queue
         Concurrency: controlled by host.json (see Section 5.5)

Input message: { url_hash, canonical_url, source_domain, category_id,
                 authority_score, published_at, title, summary }

Algorithm:
  1. Per-domain rate limit check (Redis):
       key = "domain_inflight:{source_domain}"
       count = INCR key  (atomic)
       EXPIRE key 30  (30s TTL — resets on function completion or crash)
       if count > MAX_DOMAIN_CONCURRENCY (2):
         DECR key
         abandon message (do NOT complete — SB redelivers after lockDuration)
         return

  2. UPDATE scrape_queue SET status = 'PROCESSING' WHERE url_hash = $url_hash

  3. Fetch:
       fetch(canonical_url, {
         signal: AbortSignal.timeout(9000),
         headers: { 'User-Agent': 'QuydlyBot/1.0 (+https://quydly.com/bot)' }
       })

  4. Parse: jsdom + @mozilla/readability
       const dom = new JSDOM(html, { url: canonical_url })
       const article = new Readability(dom.window.document).parse()

  5. cleaned = article?.textContent?.trim() ?? null
     content_hash = cleaned ? SHA256(cleaned) : null
     final_status = DONE | PARTIAL | LOW_QUALITY

  6. INSERT INTO raw_articles (..., is_verified=false) ON CONFLICT (url_hash) DO NOTHING

  7. UPDATE scrape_queue SET status = final_status, processed_at = now()

  8. DECR "domain_inflight:{source_domain}" in Redis

  9. Complete Service Bus message (context.done() / return without throw)

Error handling:
  - Do NOT catch errors silently — throw on network/parse/DB failure
  - Service Bus retries automatically (up to maxDeliveryCount=5)
  - After 5 failures: message dead-lettered
  - DECR Redis key in a finally block so inflight count is always released
```

**Per-domain rate limiting:**

`maxConcurrentCalls` in `host.json` is a per-instance cap. When Azure Functions scales to multiple instances (triggered by queue depth), each instance runs up to `maxConcurrentCalls` concurrent invocations — all potentially against the same domain. The Redis-based semaphore is cross-instance: a Redis INCR/DECR pair with TTL acts as a distributed counter visible to all instances.

```
Global throughput cap: maxConcurrentCalls in host.json (see 5.5)
Per-domain cap:        MAX_DOMAIN_CONCURRENCY = 2 (Redis semaphore)

If per-domain cap reached: message is abandoned, not failed.
  → SB redelivers after lockDuration (5 min) — domain backpressure without burning delivery count.
  → This does NOT increment the SB delivery counter (the message is only abandoned, not dead-lettered).
```

---

### 5.3 `article-clusterer` — Azure Timer Function (every 2 hours)

Replaces `api/cron/cluster.js`. Runs every 2 hours as a batch over unclustered articles.

```
Trigger: TimerTrigger — "0 0 */2 * * *"

Algorithm (identical to existing clusterer.js with two targeted changes):

  Change 1 — Article window filter:
    Before: ingested_at > NOW() - INTERVAL '12 hours'
    After:  clustered_at IS NULL AND status = 'DONE'
    — Processes every newly scraped article exactly once.
    — Articles are never re-selected after clustered_at is set.

  Change 2 — Synthesize-queue enqueue with idempotency:
    After cluster INSERT or UPDATE, if cluster becomes eligible:
      (cluster_score ≥ 20 AND article_ids.length ≥ 2 AND unique_domains.length ≥ 2)
      AND (synthesis_queued_at IS NULL OR synthesis_queued_at < NOW() - INTERVAL '4 hours')

      Ordering:
        a. UPDATE clusters SET synthesis_queued_at = NOW() WHERE id = $cluster_id
           — written BEFORE queue send
           — if queue send fails: synthesis_queued_at is set, no message sent
           — next clusterer run (2h later) will re-evaluate: synthesis_queued_at < NOW()-4h → re-enqueue
        b. Send message to synthesize-queue: { cluster_id, category_id }

      Duplicate messages to synthesize-queue are acceptable and harmless:
        story-synthesizer checks cluster.status on receipt;
        if already PROCESSED, it completes the message without work.

  Per-article write after clustering:
    UPDATE raw_articles SET clustered_at = NOW() WHERE id = $article_id
    — Executed after the article is appended to a cluster (or a new cluster is created).
    — Strictly IS NULL check at SELECT time prevents re-selection on next timer run.

Output: { articles_processed, clusters_updated, clusters_created, clusters_eligible }
```

---

### 5.4 `story-synthesizer` — Azure Function (Service Bus Trigger)

Replaces `api/cron/synthesize.js`. Triggered per eligible cluster message.

```
Trigger: ServiceBusTrigger — synthesize-queue
         Concurrency: 3 (host.json — see 5.5)

Input message: { cluster_id, category_id }

Algorithm (identical to existing synthesizer.js, only entry point changes):

  1. SELECT * FROM clusters WHERE id = $cluster_id AND status = 'PENDING'
     If not PENDING (already PROCESSED by a duplicate message): complete message, return.

  2. Pass 1 — fact extraction per article (same prompts, same structure)
  3. Pass 2 — narrative generation (same prompts, same scoring)
  4. computeStoryScore → storyDisposition gate
  5. River model upsert → stories (Supabase)
  6. UPDATE clusters SET status = 'PROCESSED'
  7. Complete Service Bus message

Error handling:
  - Claude API error: throw — SB retries (up to maxDeliveryCount=3)
  - After 3 failures: dead-lettered with cluster_id for manual inspection
  - DB error: throw — same behavior
```

---

### 5.5 `host.json` — Concurrency Configuration

`maxConcurrentCalls` and `autoComplete` are **host-level settings** for JavaScript Azure Functions. They are set in `host.json` — they are not valid bindings properties in `function.json` for Node.js functions.

```json
{
  "version": "2.0",
  "extensions": {
    "serviceBus": {
      "messageHandlerOptions": {
        "autoComplete": false,
        "maxConcurrentCalls": 8
      }
    }
  },
  "logging": {
    "applicationInsights": {
      "samplingSettings": { "isEnabled": false }
    }
  }
}
```

**`maxConcurrentCalls: 8`** — applies to all Service Bus triggered functions in this app.
- article-scraper: 8 concurrent scrapes per instance (adequate; Redis per-domain cap limits publisher pressure)
- story-synthesizer: 3 Claude calls in flight at once (enforced internally via p-limit, not by host.json — host.json cap is a ceiling, not a guarantee)

**`autoComplete: false`** — functions must explicitly settle messages (complete or abandon). This is required for correct retry behavior: a throw causes message abandonment and SB retry; a successful return causes completion.

**`function.json` for Service Bus triggers** contains only binding metadata — no concurrency settings:

```json
{
  "bindings": [
    {
      "name": "message",
      "type": "serviceBusTrigger",
      "direction": "in",
      "queueName": "scrape-queue",
      "connection": "AZURE_SERVICE_BUS_CONNECTION_STRING"
    }
  ]
}
```

---

## 6. Data Flow

### 6.1 Article Scraping

```
Every 30 min — discover (Azure Timer):
  parse 65+ RSS feeds → canonicalise → dedup via scrape_queue
  new URLs: INSERT scrape_queue (QUEUED) + send to scrape-queue

Continuously — article-scraper (Azure SB trigger):
  receive message → per-domain Redis check
  fetch + Readability → INSERT raw_articles (DONE/PARTIAL/LOW_QUALITY)
  UPDATE scrape_queue status

Result: all 1,500+ daily articles processed within 30–60 min of discovery
        compared to 200/day today
```

### 6.2 Gold Set Pipeline

```
Every 2 hours — article-clusterer (Azure Timer):
  SELECT raw_articles WHERE clustered_at IS NULL AND status = 'DONE'
  entity extraction + cluster matching → clusters
  UPDATE raw_articles SET clustered_at = NOW()
  eligible clusters → synthesize-queue

Continuously — story-synthesizer (Azure SB trigger):
  receive cluster_id → fetch articles → two-pass Claude
  computeStoryScore + quality gate → upsert stories (River model)

Result: 20–50 stories built up continuously throughout the day
        by 7AM generate cron, stories table is populated
```

---

## 7. Environment Variables

### Azure Function App settings (steady state)

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=          # matches process.env.SUPABASE_SERVICE_KEY in backend code
REDIS_URL=
ANTHROPIC_API_KEY=
```

**Service Bus connection: Managed Identity (no connection string in steady state)**
See Section 8 for auth staging details.

### Vercel env additions (migration phase only — remove after Phase C cutover)

```
AZURE_SERVICE_BUS_CONNECTION_STRING=   # Send-only SAS token for shadow enqueue from Vercel discover
```

### Vercel env removals

None. Existing `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, etc. remain for `generate` and `cleanup` crons.

---

## 8. Authentication Model

### Migration Phase (temporary)

During migration, Vercel `api/cron/discover.js` needs to enqueue messages to Azure Service Bus. This requires a connection string in Vercel's env.

```
SAS Policy: quydly-pipeline-discover-send
Permissions: Send only (not Listen, not Manage)
Scope: Namespace level (access to scrape-queue send)
Used in: Vercel env as AZURE_SERVICE_BUS_CONNECTION_STRING
Lifetime: Until Phase C cutover — then revoked and removed from Vercel env
```

### Steady State (target)

Azure Functions use **Managed Identity + RBAC** — no connection strings in application config.

```
1. Enable system-assigned managed identity on Function App:
   az functionapp identity assign \
     --name quydly-pipeline-fn \
     --resource-group quydly-pipeline-rg

2. Assign Service Bus roles to the managed identity:
   # Sender role (for discover → scrape-queue, clusterer → synthesize-queue)
   az role assignment create \
     --role "Azure Service Bus Data Sender" \
     --assignee <managed-identity-principal-id> \
     --scope /subscriptions/.../resourceGroups/quydly-pipeline-rg/providers/Microsoft.ServiceBus/namespaces/quydly-pipeline

   # Receiver role (for scraper and synthesizer to consume messages)
   az role assignment create \
     --role "Azure Service Bus Data Receiver" \
     --assignee <managed-identity-principal-id> \
     --scope /subscriptions/.../resourceGroups/quydly-pipeline-rg/providers/Microsoft.ServiceBus/namespaces/quydly-pipeline

3. In function.json connection field, use the namespace URI format:
   "connection": "AZURE_SERVICE_BUS_NAMESPACE"   (env var = "quydly-pipeline.servicebus.windows.net")
   Azure Functions SDK resolves this via DefaultAzureCredential → Managed Identity automatically.

4. Do NOT set AZURE_SERVICE_BUS_CONNECTION_STRING in the Function App settings in steady state.
```

**Why Managed Identity over connection strings for Azure Functions?**

Connection strings are long-lived shared secrets with broad permissions. Managed Identity credentials rotate automatically and are scoped to the specific resource — if the Function App is compromised, the blast radius is limited to Service Bus operations on this namespace only.

---

## 9. Cost Analysis

### Azure Service Bus (Standard tier)

```
Namespace: $10/month flat
Operations: 1,500 articles/day × 2 queues (scrape/synthesize)
            = 3,000 operations/day = ~90,000/month
            First 10M operations/month: included in Standard flat fee
Cost: $10/month
```

### Azure Functions (Consumption Plan)

```
Free grant: 1,000,000 executions/month + 400,000 GB-s compute
Scraper: 1,500 invocations/day × 30 = 45,000/month     → free tier
Clusterer: 12 timer runs/day × 30 = 360/month           → free tier
Synthesizer: ~50 stories/day × 30 = 1,500/month         → free tier
Discover: 48 timer runs/day × 30 = 1,440/month          → free tier
Total: ~48,300/month — well within 1M free grant
Cost: $0/month
```

### Storage + Application Insights

```
Storage Account LRS: ~$1/month
Application Insights (< 5GB logs): $0/month
```

### Summary

| Resource | Monthly cost |
|---------|-------------|
| Service Bus Standard | $10 |
| Function App (Consumption) | $0 (free tier) |
| Storage Account | $1 |
| Application Insights | $0 |
| **Total** | **~$11/month** |

---

## 10. Migration Strategy

### Phase A — Parallel scraping (shadow mode)

1. Deploy Azure Function App with `discover` timer + `article-scraper` SB function
2. Add `AZURE_SERVICE_BUS_CONNECTION_STRING` (Send-only SAS) to Vercel env
3. Modify Vercel `api/cron/discover.js` to send to Azure SB in addition to its existing flow
4. Run both Vercel process.js cron + Azure article-scraper in parallel for 48h
5. Validate: `SELECT COUNT(*), DATE_TRUNC('hour', ingested_at) FROM raw_articles GROUP BY 2 ORDER BY 2` should show continuous growth, not a single batch spike

### Phase B — Parallel clustering + synthesis

1. Deploy `article-clusterer` timer + `story-synthesizer` SB function
2. Run alongside Vercel cluster + synthesize crons for 48h
3. Validate: `stories` table fills with 20–50/day; spot-check 5 stories for quality

### Phase C — Cutover

1. Remove from `vercel.json` crons: discover, process, cluster, synthesize
2. Deploy Vercel (generate + cleanup crons retained)
3. Revoke Send-only SAS token; remove `AZURE_SERVICE_BUS_CONNECTION_STRING` from Vercel env
4. Monitor generate cron at 7AM next day — confirm quiz generation unchanged
5. Monitor for 48h post-cutover

### Rollback at any phase

- Before Phase C: re-add cron entries to `vercel.json` → Vercel crons restore immediately. Azure Functions can be disabled per-function in Azure Portal.
- After Phase C: re-add the 4 cron entries to `vercel.json` + redeploy. Azure Functions keep running in parallel — data is preserved.

---

## 11. Drawbacks & Concerns

### 11.1 Two Runtimes to Maintain

**Problem:** Backend code now lives in both Vercel (API routes, generate + cleanup crons) and Azure (pipeline workers). Two deployment targets, two env var sets, two monitoring dashboards.

**Mitigation:**
- All Azure Function logic is a thin wrapper over existing `backend/engine/` modules, which remain the source of truth
- Shared utilities (`nlp.js`, `scoring.js`, `canonicalise.js`) are copied into `azure-functions/lib/` at scaffold time
- If these utilities change, they must be updated in both locations — document this in `CLAUDE.md`
- Azure Function App code lives in `azure-functions/` in the same repo — same PR flow

### 11.2 Clustering Race Conditions (Timer-Based Mitigation)

**Why not queue-triggered clustering?** If article-scraper enqueued each DONE article to a cluster-queue, two messages for the same topic processed concurrently could create two separate clusters (both seed new clusters instead of one seeding and the other appending). Resolving this requires distributed locking per category.

**Timer-based approach:** article-clusterer processes all unclustered articles in a single sequential pass per run. Within a run, cluster state is held in memory for the duration — no concurrent writes to the same cluster within one timer invocation.

**`clustered_at IS NULL` filter:** strictly unclustered articles only. No OR clause, no time-window reopening. An article processed in run N will never be re-selected in run N+1.

### 11.3 synthesize-queue Duplicate Messages

**Scenario:** article-clusterer runs at 10AM and 12PM. At 10AM a cluster becomes eligible — `synthesis_queued_at = NOW()` is set and a message is sent. At 12PM the cluster gains a new article, `synthesis_queued_at < NOW() - 4h` is false (only 2h elapsed) → no second message.

**If the 4h window is too short** (cluster becomes eligible again before story-synthesizer processes it): a second message is sent. story-synthesizer checks `cluster.status = 'PENDING'` at the time of processing; if already PROCESSED it completes the message with no work. Duplicates are acceptable and harmless.

### 11.4 Dead-Letter Queue Monitoring

**Problem:** failed messages accumulate silently without an active alert.

**Mitigation:** Azure Monitor alert on dead-letter message count > 0 → email alert. Weekly review via Azure Portal. Document reprocessing procedure (receive from DLQ, re-enqueue to main queue, complete DLQ message).

### 11.5 Bootstrap Order

Azure Function App must be deployed before any messages are enqueued. If discover runs before article-scraper is deployed, messages queue up safely (TTL: 7 days) and drain once the consumer is deployed.

---

## 12. Out of Scope for MVP

| Feature | Rationale for deferral |
|---------|----------------------|
| Bicep / Terraform IaC | Manual Azure Portal + CLI setup for MVP |
| VNet integration | Supabase and Anthropic are public endpoints; private networking not required |
| Separate staging Function App | Naming convention (quydly-pipeline-fn-staging) is sufficient for MVP |
| Azure API Management | Functions are internal workers, not public endpoints |
| Automatic DLQ reprocessing | Manual review via Azure Portal; automation is v2 |
| Per-function concurrency overrides | Single host.json setting sufficient; separate function apps are v2 if needed |

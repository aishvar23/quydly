# Azure Queue Pipeline — Implementation Tracker

Moves the four Vercel Cron-limited workers (discover, process, cluster, synthesize) onto
Azure Service Bus + Azure Functions to eliminate the Hobby plan 200-article/day ceiling.
Full design: [`docs/azure-queue-pipeline-design.md`](docs/azure-queue-pipeline-design.md)

**Branch:** `infra/azure-queue-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## Architecture (Steady State)

```
Azure Timer Function: discover (every 30 min)
  │ parse 65+ RSS feeds → canonicalise → dedup via scrape_queue (Supabase, audit)
  └─ send → Azure Service Bus: scrape-queue

Azure Service Bus: scrape-queue
  │ maxDeliveryCount: 5 · TTL: 7 days · lockDuration: 5 min
  └─ triggers →

Azure Function: article-scraper  (host.json maxConcurrentCalls: 8)
  │ per-domain Redis cap: 2 concurrent per domain (INCR/DECR with 30s TTL)
  │ fetch + @mozilla/readability + jsdom → raw_articles (Supabase)
  └─ UPDATE scrape_queue status

Azure Timer Function: article-clusterer (every 2 hours)
  │ SELECT raw_articles WHERE clustered_at IS NULL AND status='DONE'
  │ entity extraction + cluster matching → clusters (Supabase)
  │ UPDATE raw_articles SET clustered_at = NOW()
  └─ if cluster eligible (score ≥ 20, article_ids ≥ 2, unique_domains ≥ 2):
       a. UPDATE clusters SET synthesis_queued_at = NOW()  ← written BEFORE queue send
       b. send → Azure Service Bus: synthesize-queue

Azure Service Bus: synthesize-queue
  │ maxDeliveryCount: 3 · TTL: 2 days · lockDuration: 5 min
  └─ triggers →

Azure Function: story-synthesizer  (host.json maxConcurrentCalls: 8, p-limit: 3 internally)
  │ fetch cluster + article content
  │ if cluster.status ≠ PENDING → complete message, return (idempotent)
  │ Pass 1: Claude fact extraction per article
  │ Pass 2: Claude narrative → headline + summary + key_points + confidence_score
  │ computeStoryScore → quality gates → upsert stories (River model)
  └─ complete/abandon Service Bus message (autoComplete: false in host.json)

Vercel (retained):
  GET /api/cron/generate  — 7:00 AM — unchanged
  GET /api/cron/cleanup   — 3:00 AM — unchanged
```

**Queues in steady state: 2 only**
- `scrape-queue`: discover → article-scraper
- `synthesize-queue`: article-clusterer → story-synthesizer
- No `cluster-queue` — clustering is timer-driven to avoid concurrent-write race conditions

**Vercel crons removed after Phase C cutover:**
```
api/cron/discover.js    ← Azure Timer Function
api/cron/process.js     ← article-scraper SB Function
api/cron/cluster.js     ← article-clusterer Timer Function
api/cron/synthesize.js  ← story-synthesizer SB Function
```

**host.json (all Service Bus functions):**
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
    "applicationInsights": { "samplingSettings": { "isEnabled": false } }
  }
}
```
Note: `maxConcurrentCalls` and `autoComplete` are host-level settings — they are **not valid** in `function.json` for Node.js Azure Functions.

---

## Phase 1 — Azure Resource Provisioning

| # | Task | Status |
|---|------|--------|
| 1.1 | Create resource group: `quydly-pipeline-rg` in East US 2 | ⬜ |
| 1.2 | Create Service Bus Namespace: `quydly-pipeline` (Standard tier) | ⬜ |
| 1.3 | Create queue: `scrape-queue` — maxDelivery: 5, TTL: 7d, lock: 5 min | ⬜ |
| 1.4 | Create queue: `synthesize-queue` — maxDelivery: 3, TTL: 2d, lock: 5 min | ⬜ |
| 1.5 | Create Storage Account: `quydlypipelinesa` (Standard LRS) | ⬜ |
| 1.6 | Create Function App: `quydly-pipeline-fn` (Consumption, Node 22) | ⬜ |
| 1.7 | Create Application Insights + link to Function App | ⬜ |
| 1.8 | Fetch `RootManageSharedAccessKey` connection string from Service Bus namespace | ⬜ |
| 1.9 | Set Function App env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `AZURE_SERVICE_BUS_CONNECTION_STRING` (= RootManageSharedAccessKey connection string) | ⬜ |
| 1.10 | Create Send-only SAS policy `quydly-pipeline-discover-send` — for Vercel migration phase only | ⬜ |
| 1.11 | Add `AZURE_SERVICE_BUS_CONNECTION_STRING` (Send-only SAS value) to Vercel env — migration phase only, different value from Function App's | ⬜ |
| 1.12 | Verify dead-letter queues visible: `scrape-queue/$deadletterqueue`, `synthesize-queue/$deadletterqueue` | ⬜ |

**Azure CLI reference:**
```bash
# Resource group
az group create --name quydly-pipeline-rg --location eastus2

# Service Bus namespace
az servicebus namespace create \
  --name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --sku Standard

# Queues (2 only — no cluster-queue)
az servicebus queue create --name scrape-queue \
  --namespace-name quydly-pipeline --resource-group quydly-pipeline-rg \
  --max-delivery-count 5 --default-message-time-to-live P7D --lock-duration PT5M \
  --enable-dead-lettering-on-message-expiration true

az servicebus queue create --name synthesize-queue \
  --namespace-name quydly-pipeline --resource-group quydly-pipeline-rg \
  --max-delivery-count 3 --default-message-time-to-live P2D --lock-duration PT5M

# Storage + Function App
az storage account create --name quydlypipelinesa \
  --resource-group quydly-pipeline-rg --sku Standard_LRS

az functionapp create \
  --name quydly-pipeline-fn \
  --resource-group quydly-pipeline-rg \
  --storage-account quydlypipelinesa \
  --consumption-plan-location eastus2 \
  --runtime node --runtime-version 22 \
  --functions-version 4

# Fetch RootManageSharedAccessKey for Function App env
az servicebus namespace authorization-rule keys list \
  --name RootManageSharedAccessKey \
  --namespace-name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --query primaryConnectionString -o tsv

# Send-only SAS for Vercel migration bridge (different policy, different key)
az servicebus namespace authorization-rule create \
  --name quydly-pipeline-discover-send \
  --namespace-name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --rights Send

az servicebus namespace authorization-rule keys list \
  --name quydly-pipeline-discover-send \
  --namespace-name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --query primaryConnectionString -o tsv
```

---

## Phase 2 — Database Schema Additions

| # | Task | Status |
|---|------|--------|
| 2.1 | Add `clustered_at timestamptz` column to `raw_articles` | ⬜ |
| 2.2 | Add partial index: `idx_raw_articles_unprocessed` on `raw_articles (ingested_at) WHERE clustered_at IS NULL AND status='DONE'` | ⬜ |
| 2.3 | Add `synthesis_queued_at timestamptz` column to `clusters` | ⬜ |
| 2.4 | Confirm: all existing `raw_articles` rows have `clustered_at = NULL` (correct — no backfill needed) | ⬜ |

**Migration SQL:**
```sql
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS clustered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_raw_articles_unprocessed
  ON raw_articles (ingested_at)
  WHERE clustered_at IS NULL AND status = 'DONE';

ALTER TABLE clusters ADD COLUMN IF NOT EXISTS synthesis_queued_at timestamptz;
```

---

## Phase 3 — Azure Function App Scaffold

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `azure-functions/` top-level directory in repo | ⬜ |
| 3.2 | Init Azure Functions v4 Node.js project in `azure-functions/` | ⬜ |
| 3.3 | Create `azure-functions/host.json` with `autoComplete: false` and `maxConcurrentCalls: 8` (host-level, not per function.json) | ⬜ |
| 3.4 | Add `azure-functions/package.json`: `@azure/service-bus`, `@supabase/supabase-js`, `ioredis`, `@anthropic-ai/sdk`, `rss-parser`, `@mozilla/readability`, `jsdom` | ⬜ |
| 3.5 | Create `azure-functions/lib/clients.js` — lazy-init Supabase client (using `SUPABASE_SERVICE_KEY`), Service Bus sender via connection string, Redis client | ⬜ |
| 3.6 | Copy shared utilities into `azure-functions/lib/`: `canonicalise.js`, `nlp.js`, `scoring.js` | ⬜ |
| 3.7 | Add note to `CLAUDE.md`: these files are copies — if `backend/utils/*.js` changes, update `azure-functions/lib/` too | ⬜ |
| 3.8 | Set up `.funcignore` | ⬜ |
| 3.9 | Verify local: `func start` runs without errors | ⬜ |

**`function.json` template (Service Bus trigger — no concurrency settings here):**
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
`connection` names the env var (`AZURE_SERVICE_BUS_CONNECTION_STRING`) set in Function App Application settings.

---

## Phase 4 — Azure Function: discover (Timer)

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `azure-functions/discover/index.js` — TimerTrigger, `"0 */30 * * * *"` | ⬜ |
| 4.2 | Port RSS fetch + canonicalise logic from `api/cron/discover.js` | ⬜ |
| 4.3 | Dedup: `SELECT 1 FROM scrape_queue WHERE url_hash = $hash` — skip if exists | ⬜ |
| 4.4 | For new URLs: INSERT scrape_queue (status=QUEUED) + send to scrape-queue SB | ⬜ |
| 4.5 | Structured log: `{ event: "discover_run", feeds_attempted, feeds_ok, urls_queued, urls_skipped }` | ⬜ |
| 4.6 | Local smoke test: temporarily set schedule to `"0 * * * * *"`, trigger manually, verify messages appear in scrape-queue | ⬜ |
| 4.7 | Deploy to Function App, verify invocations in Application Insights | ⬜ |
| 4.8 | Restore schedule to `"0 */30 * * * *"` before final deploy | ⬜ |

---

## Phase 5 — Azure Function: article-scraper (Service Bus Trigger)

| # | Task | Status |
|---|------|--------|
| 5.1 | Create `azure-functions/article-scraper/index.js` — ServiceBusTrigger on `scrape-queue` | ⬜ |
| 5.2 | Port scraping logic from `backend/services/scraper.js` + `processor.js` | ⬜ |
| 5.3 | Implement Redis per-domain semaphore: INCR `domain_inflight:{domain}` with 30s TTL, cap at MAX_DOMAIN_CONCURRENCY=2; if over cap: `completeMessage()` + `scheduleMessages()` 5 min out (do NOT abandon — explicit abandon increments deliveryCount) | ⬜ |
| 5.4 | DECR Redis key in finally block — always released on completion or error | ⬜ |
| 5.5 | On failure: `throw` (not silent catch) — SB owns retry budget | ⬜ |
| 5.6 | Idempotency: `INSERT INTO raw_articles ON CONFLICT (url_hash) DO NOTHING` | ⬜ |
| 5.7 | UPDATE `scrape_queue` status: PROCESSING → DONE / PARTIAL / LOW_QUALITY / FAILED | ⬜ |
| 5.8 | Local smoke test: manually send 10 messages to scrape-queue, verify `raw_articles` rows created | ⬜ |
| 5.9 | Load test: send 200 messages — verify all processed, Redis per-domain cap visible in logs | ⬜ |
| 5.10 | Deploy to Function App | ⬜ |
| 5.11 | Monitor 24h: verify `raw_articles` count grows continuously (not in a single batch spike) | ⬜ |

---

## Phase 6 — Azure Function: article-clusterer (Timer)

| # | Task | Status |
|---|------|--------|
| 6.1 | Create `azure-functions/article-clusterer/index.js` — TimerTrigger, `"0 0 */2 * * *"` | ⬜ |
| 6.2 | Port clustering logic from `backend/engine/clusterer.js` | ⬜ |
| 6.3 | Article SELECT: `WHERE clustered_at IS NULL AND status = 'DONE'` — strictly unclustered only (no OR clause, no time-window reopening) | ⬜ |
| 6.4 | After each cluster INSERT/UPDATE: `UPDATE raw_articles SET clustered_at = NOW() WHERE id = $article_id` | ⬜ |
| 6.5 | Synthesize-queue enqueue guard: send only if `synthesis_queued_at IS NULL OR synthesis_queued_at < NOW() - INTERVAL '4 hours'` | ⬜ |
| 6.6 | Ordering: `UPDATE clusters SET synthesis_queued_at = NOW()` BEFORE `send to synthesize-queue` | ⬜ |
| 6.7 | Local smoke test: seed 50 raw_articles rows (clustered_at=NULL, status=DONE), trigger timer, verify clusters created and synthesize-queue has messages | ⬜ |
| 6.8 | Deploy to Function App | ⬜ |
| 6.9 | Monitor 24h: verify clusters populate on 2h cadence, not just at 6:30AM | ⬜ |

---

## Phase 7 — Azure Function: story-synthesizer (Service Bus Trigger)

| # | Task | Status |
|---|------|--------|
| 7.1 | Create `azure-functions/story-synthesizer/index.js` — ServiceBusTrigger on `synthesize-queue` | ⬜ |
| 7.2 | Port synthesis logic from `backend/engine/synthesizer.js` — prompts, scoring, River model unchanged | ⬜ |
| 7.3 | Entry point: receive `{ cluster_id }`, SELECT cluster by ID directly (not batch SELECT) | ⬜ |
| 7.4 | Idempotency check: if `cluster.status ≠ 'PENDING'` → complete message, return | ⬜ |
| 7.5 | Internal p-limit concurrency: 3 simultaneous Claude calls max (not host.json — p-limit applied inside the function) | ⬜ |
| 7.6 | On Claude API error: throw — SB retries up to maxDeliveryCount=3 | ⬜ |
| 7.7 | Smoke test: manually enqueue 5 eligible cluster IDs → verify stories created | ⬜ |
| 7.8 | Verify idempotency: enqueue same cluster_id twice — verify story is updated (River model), not duplicated | ⬜ |
| 7.9 | Deploy to Function App | ⬜ |
| 7.10 | Monitor 24h: verify stories table populates throughout the day (not just before 7AM) | ⬜ |

---

## Phase 8 — Dead-Letter Queue Handling

| # | Task | Status |
|---|------|--------|
| 8.1 | Create Azure Monitor alert: `scrape-queue/$deadletterqueue` Active Message Count > 0 → email `aishvar.suhane@gmail.com` | ⬜ |
| 8.2 | Create Azure Monitor alert: `synthesize-queue/$deadletterqueue` Active Message Count > 0 → email | ⬜ |
| 8.3 | Test DLQ: force a scraper error (invalid URL with correct format), confirm message dead-lettered after 5 delivery attempts | ⬜ |
| 8.4 | Document reprocessing: use Azure Service Bus Explorer (portal) to peek DLQ, move messages back to main queue | ⬜ |

**DLQ reprocessing via CLI:**
```bash
# Peek dead-lettered messages
az servicebus queue message peek \
  --queue-name scrape-queue \
  --namespace-name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --sub-queue DeadLetter \
  --message-count 10

# Move DLQ messages back: use Azure Service Bus Explorer in Azure Portal
# (receive from $deadletterqueue, re-send to main queue, complete DLQ message)
```

---

## Phase 9 — Migration Phase A: Parallel Scraping

| # | Task | Status |
|---|------|--------|
| 9.1 | Modify Vercel `api/cron/discover.js`: after existing flow, also send URLs to scrape-queue via AZURE_SERVICE_BUS_CONNECTION_STRING (Send-only SAS) | ⬜ |
| 9.2 | Run both Vercel process.js + Azure article-scraper for 48h | ⬜ |
| 9.3 | Validate continuous growth: `SELECT COUNT(*), DATE_TRUNC('hour', ingested_at) FROM raw_articles GROUP BY 2 ORDER BY 2` — should show growth across all hours, not just one spike | ⬜ |
| 9.4 | Confirm article count: Azure should deliver 5–8× more articles than Vercel-only baseline | ⬜ |

---

## Phase 10 — Migration Phase B: Parallel Clustering + Synthesis

| # | Task | Status |
|---|------|--------|
| 10.1 | Deploy article-clusterer + story-synthesizer | ⬜ |
| 10.2 | Run alongside Vercel cluster + synthesize crons for 48h | ⬜ |
| 10.3 | Validate: `SELECT COUNT(*) FROM stories WHERE published_at > NOW() - INTERVAL '24 hours'` ≥ 20 | ⬜ |
| 10.4 | Spot-check 5 stories: verify headline accurate, summary neutral, category-appropriate | ⬜ |

---

## Phase 11 — Migration Phase C: Cutover

| # | Task | Status |
|---|------|--------|
| 11.1 | Remove from `vercel.json` crons: `api/cron/discover`, `api/cron/process`, `api/cron/cluster`, `api/cron/synthesize` | ⬜ |
| 11.2 | Deploy Vercel — confirm generate + cleanup crons still present | ⬜ |
| 11.3 | Revoke Send-only SAS policy `quydly-pipeline-discover-send` in Azure | ⬜ |
| 11.4 | Remove `AZURE_SERVICE_BUS_CONNECTION_STRING` from Vercel env | ⬜ |
| 11.5 | Monitor 7AM generate cron — confirm quiz generation unchanged | ⬜ |
| 11.6 | Monitor 48h post-cutover: no regressions | ⬜ |

---

## Phase 12 — Cleanup

| # | Task | Status |
|---|------|--------|
| 12.1 | Delete Vercel handler files: `api/cron/discover.js`, `api/cron/process.js`, `api/cron/cluster.js`, `api/cron/synthesize.js` | ⬜ |
| 12.2 | Update `CLAUDE.md`: add `azure-functions/` to repo structure; note shared utils duplication | ⬜ |
| 12.3 | Update `docs/rss-pipeline-design.md` and `docs/gold-set-pipeline-design.md`: add migration note, link to this design doc | ⬜ |

---

## File Inventory

| Action | File | Phase |
|--------|------|-------|
| CREATE | `azure-functions/host.json` | 3 |
| CREATE | `azure-functions/package.json` | 3 |
| CREATE | `azure-functions/lib/clients.js` | 3 |
| CREATE | `azure-functions/lib/canonicalise.js` | 3 |
| CREATE | `azure-functions/lib/nlp.js` | 3 |
| CREATE | `azure-functions/lib/scoring.js` | 3 |
| CREATE | `azure-functions/discover/index.js` | 4 |
| CREATE | `azure-functions/discover/function.json` | 4 |
| CREATE | `azure-functions/article-scraper/index.js` | 5 |
| CREATE | `azure-functions/article-scraper/function.json` | 5 |
| CREATE | `azure-functions/article-clusterer/index.js` | 6 |
| CREATE | `azure-functions/article-clusterer/function.json` | 6 |
| CREATE | `azure-functions/story-synthesizer/index.js` | 7 |
| CREATE | `azure-functions/story-synthesizer/function.json` | 7 |
| MODIFY | `backend/db/migration_gold_set.sql` — add clustered_at + synthesis_queued_at | 2 |
| MODIFY | `api/cron/discover.js` — add SB shadow enqueue (migration phase only) | 9 |
| MODIFY | `vercel.json` — remove 4 cron entries | 11 |
| DELETE | `api/cron/discover.js` | 12 |
| DELETE | `api/cron/process.js` | 12 |
| DELETE | `api/cron/cluster.js` | 12 |
| DELETE | `api/cron/synthesize.js` | 12 |
| NO TOUCH | `backend/engine/clusterer.js` — logic ported verbatim | — |
| NO TOUCH | `backend/engine/synthesizer.js` — logic ported verbatim | — |
| NO TOUCH | `backend/services/claude.js` | — |
| NO TOUCH | `backend/jobs/generateDaily.js` | — |
| NO TOUCH | `api/questions.js` | — |
| NO TOUCH | `api/complete.js` | — |

---

## Environment Variables

| Variable | Vercel | Azure Function App |
|----------|--------|--------------------|
| `SUPABASE_URL` | existing | copy same value |
| `SUPABASE_SERVICE_KEY` | existing | copy same value (note: `SERVICE_KEY`, not `SERVICE_ROLE_KEY`) |
| `REDIS_URL` | existing | copy same value |
| `ANTHROPIC_API_KEY` | existing | copy same value |
| `AZURE_SERVICE_BUS_CONNECTION_STRING` | migration phase only (Send-only SAS) → delete after Phase 11 | RootManageSharedAccessKey — different value |

---

## Rollback

**Before Phase 11 (cutover):** Azure Functions can be disabled per-function in Azure Portal. Existing Vercel crons are still in `vercel.json` — they resume immediately on next deploy.

**After Phase 11:** Re-add the 4 cron entries to `vercel.json` + redeploy. Azure Functions continue running in parallel. DB data (`raw_articles`, `clusters`, `stories`) is preserved regardless.

# Azure Queue Pipeline — Implementation Tracker

Moves the three Vercel Cron-limited workers (discover, process, cluster, synthesize) onto
Azure Service Bus + Azure Functions to eliminate the Hobby plan 200-article/day ceiling.
Full design: [`docs/azure-queue-pipeline-design.md`](docs/azure-queue-pipeline-design.md)

**Branch:** `infra/azure-queue-pipeline`
**Status legend:** ⬜ todo · 🔄 in progress · ✅ done · ❌ blocked

---

## Architecture

```
Azure Timer Function: discover (every 30 min)
  │ parse 65+ RSS feeds → canonicalise → dedup
  │ INSERT into scrape_queue (audit)
  └─ send → Azure Service Bus: scrape-queue

Azure Service Bus: scrape-queue
  │ maxDeliveryCount: 5 · TTL: 7 days · lockDuration: 5 min
  └─ triggers →

Azure Function: article-scraper  (maxConcurrentCalls: 16)
  │ fetch + @mozilla/readability + jsdom → raw_articles (Supabase)
  │ UPDATE scrape_queue status
  └─ send (if DONE) → Azure Service Bus: cluster-queue

Azure Timer Function: article-clusterer (every 2 hours)
  │ SELECT raw_articles WHERE clustered_at IS NULL AND status='DONE'
  │ entity extraction + cluster matching → clusters (Supabase)
  │ UPDATE raw_articles SET clustered_at = NOW()
  └─ send (if cluster eligible) → Azure Service Bus: synthesize-queue
       gate: cluster_score ≥ 20 AND article_ids ≥ 2 AND unique_domains ≥ 2

Azure Service Bus: synthesize-queue
  │ maxDeliveryCount: 3 · TTL: 2 days · lockDuration: 5 min
  └─ triggers →

Azure Function: story-synthesizer  (maxConcurrentCalls: 3)
  │ fetch cluster + article content
  │ Pass 1: Claude fact extraction
  │ Pass 2: Claude narrative → headline + summary + key_points + confidence_score
  │ computeStoryScore → quality gates → upsert stories (River model)
  └─ complete/abandon Service Bus message

Vercel (retained):
  GET /api/cron/generate  — 7:00 AM — unchanged
  GET /api/cron/cleanup   — 3:00 AM — unchanged
```

**Vercel crons removed after cutover:**
```
api/cron/discover.js   ← moved to Azure Timer Function
api/cron/process.js    ← replaced by article-scraper Service Bus Function
api/cron/cluster.js    ← replaced by article-clusterer Timer Function
api/cron/synthesize.js ← replaced by story-synthesizer Service Bus Function
```

---

## Phase 1 — Azure Resource Provisioning

| # | Task | Status |
|---|------|--------|
| 1.1 | Create resource group: `quydly-pipeline-rg` in East US 2 | ⬜ |
| 1.2 | Create Service Bus Namespace: `quydly-pipeline` (Standard tier) | ⬜ |
| 1.3 | Create queue: `scrape-queue` — maxDelivery: 5, TTL: 7d, lock: 5 min | ⬜ |
| 1.4 | Create queue: `cluster-queue` — maxDelivery: 3, TTL: 2d, lock: 2 min | ⬜ |
| 1.5 | Create queue: `synthesize-queue` — maxDelivery: 3, TTL: 2d, lock: 5 min | ⬜ |
| 1.6 | Create Storage Account: `quydlypipelinesa` (Standard LRS) | ⬜ |
| 1.7 | Create Function App: `quydly-pipeline-fn` (Consumption, Node 22) | ⬜ |
| 1.8 | Create Application Insights + link to Function App | ⬜ |
| 1.9 | Copy Service Bus connection string (RootManageSharedAccessKey) | ⬜ |
| 1.10 | Set Function App environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REDIS_URL, ANTHROPIC_API_KEY, AZURE_SERVICE_BUS_CONNECTION_STRING) | ⬜ |
| 1.11 | Verify dead-letter queues exist: `scrape-queue/$deadletterqueue` etc. | ⬜ |

**Azure CLI reference (run these in order):**
```bash
# Resource group
az group create --name quydly-pipeline-rg --location eastus2

# Service Bus namespace
az servicebus namespace create \
  --name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --sku Standard

# Queues
az servicebus queue create --name scrape-queue \
  --namespace-name quydly-pipeline --resource-group quydly-pipeline-rg \
  --max-delivery-count 5 --default-message-time-to-live P7D --lock-duration PT5M

az servicebus queue create --name cluster-queue \
  --namespace-name quydly-pipeline --resource-group quydly-pipeline-rg \
  --max-delivery-count 3 --default-message-time-to-live P2D --lock-duration PT2M

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

# Fetch connection string
az servicebus namespace authorization-rule keys list \
  --name RootManageSharedAccessKey \
  --namespace-name quydly-pipeline \
  --resource-group quydly-pipeline-rg \
  --query primaryConnectionString -o tsv
```

---

## Phase 2 — Database Schema Additions

| # | Task | Status |
|---|------|--------|
| 2.1 | Add `clustered_at timestamptz` column to `raw_articles` | ⬜ |
| 2.2 | Add index: `idx_raw_articles_unprocessed` on `raw_articles (ingested_at) WHERE clustered_at IS NULL AND status='DONE'` | ⬜ |
| 2.3 | Add `synthesis_queued_at timestamptz` column to `clusters` | ⬜ |
| 2.4 | Verify existing rows have `clustered_at = NULL` (correct default) | ⬜ |

**Migration SQL:**
```sql
-- raw_articles additions
ALTER TABLE raw_articles ADD COLUMN IF NOT EXISTS clustered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_raw_articles_unprocessed
  ON raw_articles (ingested_at)
  WHERE clustered_at IS NULL AND status = 'DONE';

-- clusters additions
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS synthesis_queued_at timestamptz;
```

---

## Phase 3 — Azure Function App Scaffold

| # | Task | Status |
|---|------|--------|
| 3.1 | Create `azure-functions/` top-level directory in repo | ⬜ |
| 3.2 | Init Azure Functions v4 Node.js project in `azure-functions/` | ⬜ |
| 3.3 | Configure `host.json`: `serviceBus.messageHandlerOptions.maxConcurrentCalls: 16` for scraper, `3` for synthesizer | ⬜ |
| 3.4 | Add `package.json` with shared dependencies: `@azure/service-bus`, `@supabase/supabase-js`, `ioredis`, `@anthropic-ai/sdk`, `rss-parser`, `@mozilla/readability`, `jsdom` | ⬜ |
| 3.5 | Create shared init module: `azure-functions/lib/clients.js` — Supabase client, Service Bus sender (lazy-init, reused across warm invocations) | ⬜ |
| 3.6 | Copy shared utilities into `azure-functions/lib/`: `canonicalise.js`, `nlp.js`, `scoring.js` | ⬜ |
| 3.7 | Set up `.funcignore` to exclude `node_modules` from tracked files | ⬜ |
| 3.8 | Verify local: `func start` runs without errors | ⬜ |

**`host.json` target:**
```json
{
  "version": "2.0",
  "extensions": {
    "serviceBus": {
      "messageHandlerOptions": {
        "autoComplete": false,
        "maxConcurrentCalls": 1
      }
    }
  },
  "logging": {
    "applicationInsights": { "samplingSettings": { "isEnabled": false } }
  }
}
```
Note: `maxConcurrentCalls` is set per-function in `function.json` — the host.json value is the default.

---

## Phase 4 — Azure Function: discover (Timer)

| # | Task | Status |
|---|------|--------|
| 4.1 | Create `azure-functions/discover/index.js` — Timer trigger, `"0 */30 * * * *"` | ⬜ |
| 4.2 | Port RSS fetch + canonicalise logic from existing `api/cron/discover.js` | ⬜ |
| 4.3 | Replace `INSERT INTO scrape_queue` with: INSERT (audit) + send to `scrape-queue` Service Bus | ⬜ |
| 4.4 | Dedup check before send: `SELECT 1 FROM scrape_queue WHERE url_hash = $hash` — skip if exists | ⬜ |
| 4.5 | Add structured logging: `{ event: "discover_run", feeds_attempted, feeds_ok, urls_queued, urls_skipped }` | ⬜ |
| 4.6 | Local smoke test: set timer to `"0 * * * * *"` (every minute), trigger manually, verify messages appear in Azure SB queue | ⬜ |
| 4.7 | Deploy to Azure Function App, verify invocations in Application Insights | ⬜ |
| 4.8 | Restore timer to `"0 */30 * * * *"` before final deploy | ⬜ |

**`function.json` for discover:**
```json
{
  "bindings": [
    {
      "name": "timer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 */30 * * * *"
    }
  ]
}
```

---

## Phase 5 — Azure Function: article-scraper (Service Bus Trigger)

| # | Task | Status |
|---|------|--------|
| 5.1 | Create `azure-functions/article-scraper/index.js` — ServiceBusTrigger on `scrape-queue` | ⬜ |
| 5.2 | Port scraping logic from existing `backend/services/scraper.js` + `processor.js` | ⬜ |
| 5.3 | On success (DONE): `context.done()` to complete message + send to `cluster-queue` | ⬜ |
| 5.4 | On failure: `throw` — let Service Bus own retry (do NOT catch silently) | ⬜ |
| 5.5 | Verify idempotency: `INSERT INTO raw_articles ON CONFLICT (url_hash) DO NOTHING` | ⬜ |
| 5.6 | UPDATE `scrape_queue` status on each outcome: PROCESSING → DONE/PARTIAL/LOW_QUALITY/FAILED | ⬜ |
| 5.7 | Set `maxConcurrentCalls: 16` in `function.json` | ⬜ |
| 5.8 | Local smoke test: manually send 10 messages to scrape-queue, verify `raw_articles` rows created | ⬜ |
| 5.9 | Load test: send 200 messages, verify all 200 processed without DB errors | ⬜ |
| 5.10 | Deploy to Azure Function App | ⬜ |
| 5.11 | Monitor for 24h: check `raw_articles` count grows continuously, not in batch | ⬜ |

**`function.json` for article-scraper:**
```json
{
  "bindings": [
    {
      "name": "message",
      "type": "serviceBusTrigger",
      "direction": "in",
      "queueName": "scrape-queue",
      "connection": "AZURE_SERVICE_BUS_CONNECTION_STRING",
      "maxConcurrentCalls": 16,
      "autoComplete": false
    }
  ]
}
```

---

## Phase 6 — Azure Function: article-clusterer (Timer)

| # | Task | Status |
|---|------|--------|
| 6.1 | Create `azure-functions/article-clusterer/index.js` — TimerTrigger, `"0 0 */2 * * *"` | ⬜ |
| 6.2 | Port clustering logic from existing `backend/engine/clusterer.js` | ⬜ |
| 6.3 | Modify article SELECT: `WHERE clustered_at IS NULL AND status = 'DONE'` (not time-window) | ⬜ |
| 6.4 | After cluster INSERT/UPDATE: `UPDATE raw_articles SET clustered_at = NOW() WHERE id = $article_id` | ⬜ |
| 6.5 | After cluster update: check eligibility — if eligible AND `synthesis_queued_at < NOW() - 2h OR NULL`: send to synthesize-queue + set `synthesis_queued_at = NOW()` | ⬜ |
| 6.6 | Verify: article processed twice in one window still gets `clustered_at` set only once | ⬜ |
| 6.7 | Local smoke test: seed raw_articles with 50 test rows, trigger timer, verify clusters created | ⬜ |
| 6.8 | Deploy to Azure Function App | ⬜ |
| 6.9 | Monitor for 24h: verify clusters populate between 7AM generate runs | ⬜ |

---

## Phase 7 — Azure Function: story-synthesizer (Service Bus Trigger)

| # | Task | Status |
|---|------|--------|
| 7.1 | Create `azure-functions/story-synthesizer/index.js` — ServiceBusTrigger on `synthesize-queue` | ⬜ |
| 7.2 | Port synthesis logic from existing `backend/engine/synthesizer.js` — UNCHANGED prompts, scoring, River model | ⬜ |
| 7.3 | Entry point: receive `{ cluster_id }` message, SELECT cluster by ID (not batch SELECT) | ⬜ |
| 7.4 | Idempotency check: if cluster.status = 'PROCESSED' within last 2h → complete message, return | ⬜ |
| 7.5 | On Claude API error: throw — let Service Bus retry (up to 3) | ⬜ |
| 7.6 | Set `maxConcurrentCalls: 3` (Claude API rate limit) | ⬜ |
| 7.7 | Smoke test: manually enqueue 5 cluster IDs (with eligible clusters in DB), verify stories created | ⬜ |
| 7.8 | Verify River model: enqueue same cluster twice — verify story is updated, not duplicated | ⬜ |
| 7.9 | Deploy to Azure Function App | ⬜ |
| 7.10 | Monitor for 24h: verify stories table populates before 7AM | ⬜ |

---

## Phase 8 — Dead-Letter Queue Handling

| # | Task | Status |
|---|------|--------|
| 8.1 | Create Azure Monitor alert: `scrape-queue/$deadletterqueue` count > 0 → email alert | ⬜ |
| 8.2 | Create Azure Monitor alert: `synthesize-queue/$deadletterqueue` count > 0 → email alert | ⬜ |
| 8.3 | Document reprocessing procedure: how to move DLQ messages back to main queue | ⬜ |
| 8.4 | Test dead-letter: force a scraper error (bad URL), verify message appears in DLQ after 5 attempts | ⬜ |

**DLQ reprocessing (Azure Service Bus Explorer or CLI):**
```bash
# List dead-lettered messages
az servicebus queue message peek \
  --queue-name "scrape-queue/$deadletterqueue" \
  --namespace-name quydly-pipeline \
  --resource-group quydly-pipeline-rg

# Move DLQ messages back to main queue — use Azure Service Bus Explorer (portal)
# or Service Bus SDK: receive from DLQ, re-send to main queue, complete DLQ message
```

---

## Phase 9 — Parallel Run & Verification

| # | Task | Status |
|---|------|--------|
| 9.1 | Add `AZURE_SERVICE_BUS_CONNECTION_STRING` to Vercel env (transition only) | ⬜ |
| 9.2 | Modify Vercel `api/cron/discover.js` to ALSO send to Azure SB (shadow enqueue alongside existing flow) | ⬜ |
| 9.3 | Run both pipelines in parallel for 48h: Vercel process cron + Azure article-scraper | ⬜ |
| 9.4 | Compare counts: `SELECT COUNT(*) FROM raw_articles WHERE ingested_at > NOW() - INTERVAL '24 hours'` — should see 5–8× growth | ⬜ |
| 9.5 | Run cluster + synthesize Azure functions in parallel with Vercel crons for 48h | ⬜ |
| 9.6 | Verify stories quality: spot-check 5 stories from Azure pipeline | ⬜ |
| 9.7 | Confirm 20–50 stories/day target met | ⬜ |

---

## Phase 10 — Vercel Cron Cutover

| # | Task | Status |
|---|------|--------|
| 10.1 | Remove `api/cron/process.js` from `vercel.json` crons | ⬜ |
| 10.2 | Remove `api/cron/cluster.js` from `vercel.json` crons | ⬜ |
| 10.3 | Remove `api/cron/synthesize.js` from `vercel.json` crons | ⬜ |
| 10.4 | Remove `api/cron/discover.js` from `vercel.json` crons (after Azure discover verified) | ⬜ |
| 10.5 | Deploy Vercel — confirm generate + cleanup crons still present | ⬜ |
| 10.6 | Remove `AZURE_SERVICE_BUS_CONNECTION_STRING` from Vercel env (no longer needed) | ⬜ |
| 10.7 | Monitor for 24h post-cutover: verify no regressions in quiz generation at 7AM | ⬜ |

---

## Phase 11 — Cleanup & Documentation

| # | Task | Status |
|---|------|--------|
| 11.1 | Delete `backend/services/processor.js` (if all logic ported to Azure Function) | ⬜ |
| 11.2 | Remove Vercel cron handler files: `api/cron/discover.js`, `process.js`, `cluster.js`, `synthesize.js` | ⬜ |
| 11.3 | Update `docs/rss-pipeline-design.md` — note Azure migration, link to `azure-queue-pipeline-design.md` | ⬜ |
| 11.4 | Update `docs/gold-set-pipeline-design.md` — same | ⬜ |
| 11.5 | Update `CLAUDE.md` — add `azure-functions/` to repo structure | ⬜ |

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
| MODIFY | `vercel.json` — remove 4 cron entries in phase 10 | 10 |
| DELETE | `api/cron/discover.js` | 10 |
| DELETE | `api/cron/process.js` | 10 |
| DELETE | `api/cron/cluster.js` | 10 |
| DELETE | `api/cron/synthesize.js` | 10 |
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
| `SUPABASE_SERVICE_ROLE_KEY` | existing | copy same value |
| `REDIS_URL` | existing | copy same value |
| `ANTHROPIC_API_KEY` | existing | copy same value |
| `AZURE_SERVICE_BUS_CONNECTION_STRING` | add (transition only, remove in phase 10) | add |

---

## Rollback

At any phase before Phase 10, rollback is instant:
- Azure Functions can be disabled per-function in Azure Portal
- The existing Vercel crons are still present until Phase 10 — they resume immediately

After Phase 10 cutover, rollback means re-adding the 4 cron entries to `vercel.json` and redeploying Vercel. Data in `raw_articles`, `clusters`, and `stories` is preserved regardless.

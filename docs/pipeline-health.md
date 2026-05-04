# Pipeline Health Guide

Quick reference for checking the status of the Quydly news pipeline after an outage, credit lapse, or suspected stall.

## Run the health check

```bash
node azure-functions/scripts/pipeline-health.js
```

Requires env vars in `azure-functions/.env`:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Azure CLI (`az`) logged in — needed for live Service Bus queue counts

---

## What the script checks

### raw_articles
The raw scrape output. Each URL discovered by the `discover` function ends up here after `article-scraper` processes it.

| Metric | Healthy | Action if not |
|--------|---------|---------------|
| Status breakdown | Mostly `DONE`, some `LOW_QUALITY` | `FAILED` rows → check scraper logs |
| Unclustered backlog | 0 | Trigger `article-clusterer` manually (see below) |

### clusters
Groups of related articles. Created by `article-clusterer` (runs every 2h).

| Metric | Healthy | Action if not |
|--------|---------|---------------|
| Status breakdown | Mostly `PROCESSED`, low `PENDING` | Expected — PENDING = awaiting synthesis |
| Stuck `PROCESSING` | 0 | Reset stuck rows (see below) |
| Not queued for synthesis | Low | Will be picked up on next clusterer run |

### stories
Final synthesised output consumed by the quiz. Created by `story-synthesizer`.

| Metric | Healthy | Action if not |
|--------|---------|---------------|
| Last 24h | > 0 | Pipeline likely stalled — check clusters and DLQ |
| Per-day breakdown | Consistent daily flow | Gap = outage period |

### Service Bus queues
Azure Service Bus queues that connect the pipeline stages.

| Queue | Active messages | DLQ |
|-------|----------------|-----|
| `scrape-queue` | Normal = low, drains fast | > 0 DLQ → scraper errors, check `peek-dlq.js` |
| `synthesize-queue` | Normal = low | > 0 DLQ → synthesizer errors, check `peek-dlq.js` |

---

## Common recovery actions

### Drain a clustering backlog
After an outage, thousands of articles may be scraped at once and need clustering.
The clusterer processes `BATCH_SIZE=2000` per run. Trigger it manually in a loop:

```bash
MASTER_KEY=$(az functionapp keys list \
  --resource-group quydly-pipeline-rg \
  --name quydly-pipeline-fn \
  --query "masterKey" -o tsv)

# Repeat until health check shows unclustered backlog = 0
curl -X POST "https://quydly-pipeline-fn.azurewebsites.net/admin/functions/article-clusterer" \
  -H "x-functions-key: $MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d "{}"
```

Wait ~3 minutes between triggers, then re-run the health check to track progress.

### Reset stuck PROCESSING clusters
Clusters left mid-synthesis when the pipeline died will never self-heal.

```sql
UPDATE clusters
SET status = 'PENDING', synthesis_queued_at = NULL
WHERE status = 'PROCESSING'
  AND created_at < NOW() - INTERVAL '1 hour';
```

Run via Supabase dashboard → SQL editor, or via the MCP Supabase tool.
The next clusterer run will re-queue them for synthesis.

### Inspect / replay / purge DLQ messages

```bash
cd azure-functions

node peek-dlq.js    # inspect dead-letter reason before acting
node replay-dlq.js  # replay — use after fixing the underlying error
node purge-dlq.js   # discard — use for stale/unfixable messages
```

All three require `AZURE_SERVICE_BUS_CONNECTION_STRING` (RootManageSharedAccessKey) in env.

---

## Pipeline architecture (quick reference)

```
discover (Timer, 30 min)
  └─ scrape-queue (Service Bus)
       └─ article-scraper (SB trigger)
            └─ raw_articles (Supabase)

article-clusterer (Timer, 2h)
  reads raw_articles WHERE clustered_at IS NULL AND status='DONE'
  └─ clusters (Supabase)
       └─ synthesize-queue (Service Bus)
            └─ story-synthesizer (SB trigger)
                 └─ stories (Supabase)

generate (Vercel Cron, 7AM)
  reads stories → generates daily quiz questions
```

Full design: [`docs/azure-queue-pipeline-design.md`](azure-queue-pipeline-design.md)

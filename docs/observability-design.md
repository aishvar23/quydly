# Quydly Pipeline Observability — Design Doc

> **Status:** Draft for review
> **Author:** Aishvarya + Claude
> **Date:** 2026-04-18

---

## 1. Goals

Full operational visibility into the Azure Functions pipeline and user-facing app:

- **Throughput**: how many articles/clusters/stories does each stage produce per hour and per day?
- **Latency**: how long does each stage take (p50, p95, p99)?
- **Failure rate**: what % of scrapes fail? What % of syntheses get rejected by quality gates?
- **Backlog**: how deep are the Service Bus queues? Are we keeping up?
- **Pipeline health**: are timers firing on schedule? Is the funnel (URLs → articles → clusters → stories → quiz questions) healthy?
- **User metrics**: DAU, quiz completions, streaks, score distributions

---

## 2. Where the Data Lives

| Source | What it knows | Access method |
|--------|---------------|---------------|
| **Application Insights** | Function invocations, duration, exceptions, custom JSON logs (all the `context.log(JSON.stringify({...}))` events) | KQL queries |
| **Supabase (Postgres)** | Entity counts + timestamps: `scrape_queue`, `raw_articles`, `clusters`, `stories`, `users`, `completions`, `daily_questions` | SQL / pg views |
| **Azure Service Bus** | Active message count, DLQ depth, scheduled message count | Azure Monitor metrics |
| **Redis** | `domain_inflight:*` keys (ephemeral — only useful for real-time) | Redis CLI / INFO |

---

## 3. Recommended Approach

### Primary: Azure Monitor Workbooks + Supabase SQL Views

**Why not Grafana (yet):**
- You already have Application Insights wired up with sampling disabled (host.json)
- Azure Monitor Workbooks are free, native, and can query App Insights (KQL) + Azure Service Bus metrics in one place
- Supabase has a built-in SQL editor for ad-hoc queries and you can create saved views
- Adding Grafana means another service to manage (auth, data source config, hosting) — worth it later at scale, overkill now

**When to upgrade to Grafana:**
- When you want a single pane combining App Insights + Postgres + SB metrics
- When you want to share dashboards with others
- Grafana Cloud free tier (50GB logs/month) would work — connect Azure Monitor + Postgres data sources

### Implementation: 3 pieces

1. **Azure Monitor Workbook** — pipeline function metrics (latency, throughput, errors, SB queue depth)
2. **Supabase SQL views** — entity funnel counts, hourly/daily rollups, quality gate pass rates
3. **Azure Monitor Alerts** — you already have DLQ alerts; add a few more for pipeline stalls

---

## 4. Metrics Inventory

### 4.1 Pipeline Throughput (per hour / per day)

| Metric | Source | Query approach |
|--------|--------|----------------|
| URLs discovered | App Insights → `discover_run.urls_queued` | KQL: parse JSON from `traces` table |
| URLs skipped (dedup) | App Insights → `discover_run.urls_skipped` | KQL |
| Articles scraped (DONE) | Supabase → `scrape_queue WHERE status='DONE'` grouped by `processed_at` | SQL view |
| Articles failed | Supabase → `scrape_queue WHERE status='FAILED'` | SQL view |
| Articles low quality | Supabase → `scrape_queue WHERE status='LOW_QUALITY'` | SQL view |
| Clusters created | App Insights → `clustering_complete.clusters_created` | KQL |
| Clusters eligible for synthesis | App Insights → `clustering_complete.clusters_eligible` | KQL |
| Stories written | App Insights → `story_written` event count | KQL |
| Stories merged (River) | App Insights → `story_merged` event count | KQL |
| Stories rejected (quality gates) | App Insights → `LOW_CONFIDENCE` + `LOW_KEY_POINTS` + `LOW_STORY_SCORE` | KQL |
| Quiz questions generated | Supabase → `daily_questions` row count | SQL |

### 4.2 Pipeline Latency

| Metric | How to measure |
|--------|----------------|
| **discover** duration | App Insights → function duration (built-in `requests` table) |
| **article-scraper** per-message duration | App Insights → function duration |
| **article-clusterer** duration | App Insights → function duration |
| **story-synthesizer** per-message duration | App Insights → function duration |
| **End-to-end: URL discovered → article scraped** | Supabase: `scrape_queue.processed_at - scrape_queue.discovered_at` |
| **End-to-end: article scraped → story published** | Supabase: `stories.published_at - MIN(raw_articles.scraped_at)` for articles in the cluster |
| **Domain throttle delay** | App Insights → count of `domain_throttled` events (each = 5 min delay) |

### 4.3 Failure Rates

| Metric | Source |
|--------|--------|
| Feed parse errors | App Insights → `feed_error` event count / `discover_run.feeds_attempted` |
| Scrape HTTP errors (by status code) | App Insights → `scrape_skip` events grouped by `http_status` |
| Scrape exceptions (retryable) | App Insights → `scrape_error` event count |
| DLQ depth (scrape-queue) | Azure Monitor → Service Bus metric `DeadletteredMessages` |
| DLQ depth (synthesize-queue) | Azure Monitor → Service Bus metric `DeadletteredMessages` |
| Claude API errors | App Insights → `synthesis_attempt_failed` count |
| Synthesis quality gate rejections | App Insights → `LOW_CONFIDENCE` + `LOW_KEY_POINTS` + `LOW_STORY_SCORE` counts |

### 4.4 Backlog / Queue Health

| Metric | Source |
|--------|--------|
| scrape-queue active messages | Azure Monitor → SB metric `ActiveMessages` for `scrape-queue` |
| scrape-queue scheduled messages | Azure Monitor → SB metric `ScheduledMessages` (domain-throttled reschedules) |
| synthesize-queue active messages | Azure Monitor → SB metric `ActiveMessages` for `synthesize-queue` |
| Unscraped URLs (PENDING in DB) | Supabase → `SELECT COUNT(*) FROM scrape_queue WHERE status = 'PENDING'` |
| Unclustered articles | Supabase → `SELECT COUNT(*) FROM raw_articles WHERE clustered_at IS NULL AND status = 'DONE'` |
| PENDING clusters (awaiting synthesis) | Supabase → `SELECT COUNT(*) FROM clusters WHERE status = 'PENDING'` |

### 4.5 Pipeline Funnel (daily snapshot)

```
URLs discovered          ████████████████████████  2,400
  ├─ skipped (dedup)     ████████████████          1,600
  └─ queued to scrape    ████████                    800
      ├─ scraped (DONE)  ██████                      600
      ├─ LOW_QUALITY     █                             80
      └─ FAILED          ▌                             40
          ↓
Clusters created                ███                    30
Clusters eligible               ██                     20
          ↓
Stories written                 █                      12
Stories merged                  ▌                       5
Stories rejected (gates)        ▌                       3
          ↓
Quiz questions (7AM)                                    5
```

### 4.6 User Metrics

| Metric | Source |
|--------|--------|
| DAU | Supabase → `SELECT COUNT(DISTINCT user_id) FROM completions WHERE date = CURRENT_DATE` |
| Quiz completions / day | Supabase → `SELECT COUNT(*) FROM completions WHERE date = CURRENT_DATE` |
| Average score | Supabase → `SELECT AVG(score) FROM completions WHERE date = CURRENT_DATE` |
| Score distribution | Supabase → histogram of `completions.score` |
| Active streaks | Supabase → `SELECT streak, COUNT(*) FROM users WHERE last_played >= CURRENT_DATE - 1 GROUP BY streak` |
| New users / day | Supabase → `SELECT COUNT(*) FROM users WHERE created_at::date = CURRENT_DATE` |
| Retention (D1/D7/D30) | Supabase → cohort query on `completions` |

---

## 5. Implementation Plan

### 5A. Supabase SQL Views (entity counts + funnel)

Create these as Postgres views so they're always fresh and queryable from the Supabase dashboard:

```sql
-- Hourly scrape throughput
CREATE OR REPLACE VIEW v_scrape_hourly AS
SELECT
  date_trunc('hour', processed_at) AS hour,
  status,
  COUNT(*) AS count
FROM scrape_queue
WHERE processed_at IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC;

-- Hourly article ingest
CREATE OR REPLACE VIEW v_articles_hourly AS
SELECT
  date_trunc('hour', scraped_at) AS hour,
  status,
  COUNT(*) AS count
FROM raw_articles
GROUP BY 1, 2
ORDER BY 1 DESC;

-- Hourly story output
CREATE OR REPLACE VIEW v_stories_hourly AS
SELECT
  date_trunc('hour', published_at) AS hour,
  COUNT(*) AS stories_published,
  AVG(story_score) AS avg_story_score,
  AVG(confidence_score) AS avg_confidence,
  AVG(source_count) AS avg_sources
FROM stories
WHERE published_at IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- Daily pipeline funnel
CREATE OR REPLACE VIEW v_daily_funnel AS
SELECT
  d.date,
  COALESCE(sq.discovered, 0)   AS urls_discovered,
  COALESCE(sq.scraped, 0)      AS articles_scraped,
  COALESCE(sq.failed, 0)       AS articles_failed,
  COALESCE(sq.low_quality, 0)  AS articles_low_quality,
  COALESCE(cl.created, 0)      AS clusters_created,
  COALESCE(cl.eligible, 0)     AS clusters_synthesized,
  COALESCE(st.published, 0)    AS stories_published,
  COALESCE(dq.has_quiz, 0)     AS quiz_generated
FROM generate_series(
  CURRENT_DATE - INTERVAL '30 days',
  CURRENT_DATE,
  '1 day'
) AS d(date)
LEFT JOIN (
  SELECT discovered_at::date AS date,
    COUNT(*) AS discovered,
    COUNT(*) FILTER (WHERE status = 'DONE') AS scraped,
    COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
    COUNT(*) FILTER (WHERE status = 'LOW_QUALITY') AS low_quality
  FROM scrape_queue
  GROUP BY 1
) sq ON sq.date = d.date
LEFT JOIN (
  SELECT created_at::date AS date,
    COUNT(*) AS created,
    COUNT(*) FILTER (WHERE status = 'PROCESSED') AS eligible
  FROM clusters
  GROUP BY 1
) cl ON cl.date = d.date
LEFT JOIN (
  SELECT published_at::date AS date,
    COUNT(*) AS published
  FROM stories
  GROUP BY 1
) st ON st.date = d.date
LEFT JOIN (
  SELECT date, 1 AS has_quiz
  FROM daily_questions
) dq ON dq.date = d.date;

-- Scrape latency (time from discovered to processed)
CREATE OR REPLACE VIEW v_scrape_latency AS
SELECT
  date_trunc('hour', processed_at) AS hour,
  COUNT(*) AS count,
  AVG(EXTRACT(EPOCH FROM (processed_at - discovered_at))) AS avg_seconds,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - discovered_at))) AS p50_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - discovered_at))) AS p95_seconds
FROM scrape_queue
WHERE processed_at IS NOT NULL AND discovered_at IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- Domain breakdown (top domains by volume + failure rate)
CREATE OR REPLACE VIEW v_domain_stats AS
SELECT
  domain,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'DONE') AS done,
  COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
  COUNT(*) FILTER (WHERE status = 'LOW_QUALITY') AS low_quality,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'FAILED') / NULLIF(COUNT(*), 0), 1) AS fail_pct
FROM scrape_queue
WHERE discovered_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY total DESC;

-- User metrics: daily active + completions
CREATE OR REPLACE VIEW v_user_daily AS
SELECT
  date,
  COUNT(DISTINCT user_id) AS dau,
  COUNT(*) AS completions,
  AVG(score) AS avg_score,
  MAX(score) AS max_score
FROM completions
WHERE date > CURRENT_DATE - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1 DESC;

-- Current pipeline backlog
CREATE OR REPLACE VIEW v_backlog AS
SELECT
  (SELECT COUNT(*) FROM scrape_queue WHERE status = 'PENDING') AS pending_scrapes,
  (SELECT COUNT(*) FROM raw_articles WHERE clustered_at IS NULL AND status = 'DONE') AS unclustered_articles,
  (SELECT COUNT(*) FROM clusters WHERE status = 'PENDING') AS pending_clusters,
  (SELECT COUNT(*) FROM clusters WHERE status = 'PROCESSING') AS processing_clusters;
```

### 5B. Azure Monitor Workbook

Create a workbook in the Azure Portal (`Application Insights → Workbooks → New`) with these KQL queries:

**Tab 1: Pipeline Overview**

```kql
// Function invocation throughput (last 24h, per function, per hour)
requests
| where timestamp > ago(24h)
| summarize count() by bin(timestamp, 1h), cloud_RoleName
| render timechart

// Function duration percentiles
requests
| where timestamp > ago(24h)
| summarize
    p50 = percentile(duration, 50),
    p95 = percentile(duration, 95),
    p99 = percentile(duration, 99)
  by bin(timestamp, 1h), cloud_RoleName
| render timechart

// Error rate by function
requests
| where timestamp > ago(24h)
| summarize
    total = count(),
    failed = countif(success == false)
  by bin(timestamp, 1h), cloud_RoleName
| extend error_rate = round(100.0 * failed / total, 1)
| render timechart
```

**Tab 2: Discover**

```kql
// Discover run stats (from structured logs)
traces
| where timestamp > ago(24h)
| where message has "discover_run"
| extend parsed = parse_json(message)
| project
    timestamp,
    feeds_ok       = toint(parsed.feeds_ok),
    feeds_failed   = toint(parsed.feeds_failed),
    urls_queued    = toint(parsed.urls_queued),
    urls_skipped   = toint(parsed.urls_skipped)
| render timechart
```

**Tab 3: Scraper**

```kql
// Scrape outcomes
traces
| where timestamp > ago(24h)
| where message has "article_scraped" or message has "scrape_skip" or message has "scrape_error"
| extend parsed = parse_json(message)
| extend event = tostring(parsed.event)
| summarize count() by bin(timestamp, 1h), event
| render timechart

// Domain throttle events
traces
| where timestamp > ago(24h)
| where message has "domain_throttled"
| extend parsed = parse_json(message)
| summarize throttle_count = count() by bin(timestamp, 1h), tostring(parsed.domain)
| render timechart
```

**Tab 4: Clustering**

```kql
// Clustering run metrics
traces
| where timestamp > ago(7d)
| where message has "clustering_complete"
| extend parsed = parse_json(message)
| project
    timestamp,
    articles_processed       = toint(parsed.articles_processed),
    clusters_created         = toint(parsed.clusters_created),
    clusters_updated         = toint(parsed.clusters_updated),
    clusters_eligible        = toint(parsed.clusters_eligible),
    clusters_below_quality   = toint(parsed.clusters_below_quality)
| render timechart
```

**Tab 5: Synthesis**

```kql
// Synthesis outcomes
traces
| where timestamp > ago(24h)
| where message has "story_written"
    or message has "story_merged"
    or message has "LOW_CONFIDENCE"
    or message has "LOW_KEY_POINTS"
    or message has "LOW_STORY_SCORE"
    or message has "cluster_not_pending"
| extend parsed = parse_json(message)
| extend event = tostring(parsed.event)
| summarize count() by bin(timestamp, 1h), event
| render timechart

// Story score distribution (last 7 days)
traces
| where timestamp > ago(7d)
| where message has "story_written" or message has "story_merged"
| extend parsed = parse_json(message)
| extend score = todouble(parsed.story_score)
| summarize count() by bin(score, 5)
| render columnchart
```

**Tab 6: Service Bus Queues**

Add Azure Monitor metric charts (native workbook widget, no KQL needed):
- `scrape-queue`: ActiveMessages, DeadletteredMessages, ScheduledMessages
- `synthesize-queue`: ActiveMessages, DeadletteredMessages

### 5C. Additional Alerts

You already have DLQ alerts. Add these:

| Alert | Condition | Severity |
|-------|-----------|----------|
| **Discover stall** | No `discover_run` trace in App Insights for > 90 minutes | Sev 2 |
| **Clusterer stall** | No `clustering_complete` trace for > 5 hours | Sev 2 |
| **Scrape backlog** | `scrape-queue` ActiveMessages > 500 for > 30 min | Sev 3 |
| **Synthesize backlog** | `synthesize-queue` ActiveMessages > 50 for > 30 min | Sev 3 |
| **High scrape failure rate** | > 30% of scrapes FAILED in the last hour | Sev 2 |
| **No stories produced** | 0 `story_written` or `story_merged` traces in 12 hours | Sev 1 |
| **7AM generate failure** | `generate_daily` function fails or produces 0 questions | Sev 1 |

All alerts → email to `aishvar.suhane@gmail.com` (same as existing DLQ alerts).

---

## 6. Dashboard Layout Summary

### Azure Workbook: "Pipeline Health"

```
┌─────────────────────────────────────────────────────────────┐
│  OVERVIEW (top row — big number tiles)                      │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │URLs  │ │Artic-│ │Clust-│ │Stori-│ │SB    │ │Errors│   │
│  │Today │ │les   │ │ers   │ │es    │ │Backlog│ │Today │   │
│  │ 2,400│ │  600 │ │   30 │ │   12 │ │   45 │ │   3% │   │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘   │
├─────────────────────────────────────────────────────────────┤
│  THROUGHPUT (timechart — 24h, per-hour bars)                │
│  [URLs queued] [Articles scraped] [Clusters] [Stories]      │
├─────────────────────────────────────────────────────────────┤
│  LATENCY (timechart — p50/p95 lines per function)           │
├─────────────────────────────────────────────────────────────┤
│  QUEUE DEPTH (area chart — SB active + scheduled messages)  │
├─────────────────────────────────────────────────────────────┤
│  ERROR BREAKDOWN (stacked bar — by error type per hour)     │
└─────────────────────────────────────────────────────────────┘
```

### Supabase SQL Editor: saved queries

- `SELECT * FROM v_daily_funnel ORDER BY date DESC LIMIT 7` — weekly funnel
- `SELECT * FROM v_backlog` — current backlog snapshot
- `SELECT * FROM v_domain_stats LIMIT 20` — top domains + failure rates
- `SELECT * FROM v_scrape_latency LIMIT 24` — last 24h latency percentiles
- `SELECT * FROM v_user_daily LIMIT 30` — user engagement last 30 days

---

## 7. What You Don't Need Yet

- **Grafana** — adds infra complexity; revisit when you want a single dashboard combining Postgres + App Insights + SB, or when sharing with a team
- **Custom metrics endpoint** — the structured JSON logs + App Insights KQL are sufficient; no need to emit custom OpenTelemetry metrics
- **Log forwarding** — App Insights already captures everything with sampling disabled
- **Real-time Redis monitoring** — `domain_inflight:*` keys are ephemeral (30s TTL); not worth dashboarding. If you need to debug throttling, `redis-cli KEYS domain_inflight:*` is enough

---

## 8. Effort Estimate

| Task | Effort |
|------|--------|
| Create Supabase SQL views (copy-paste from section 5A) | 15 min |
| Create Azure Workbook with KQL queries (section 5B) | 45 min |
| Set up additional alerts (section 5C) | 20 min |
| **Total** | ~1.5 hours |

---

## 9. Future: Grafana Upgrade Path

When the time comes:

1. Sign up for Grafana Cloud free tier (50GB logs, 10k metrics series)
2. Add data sources:
   - **Azure Monitor** → App Insights + Service Bus metrics
   - **PostgreSQL** → Supabase connection string (read-only role)
3. Import the KQL queries as Azure Monitor panels
4. Import the SQL views as Postgres panels
5. Build a single unified dashboard

The SQL views and KQL queries in this doc are designed to be portable to Grafana panels with minimal changes.

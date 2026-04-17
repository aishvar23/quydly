// Pipeline health check — verifies 5.11, 6.9, 7.10 monitoring concerns.
// Usage: node --env-file=.env scripts/check-pipeline.js
// Run on demand or periodically to confirm the Azure pipeline is healthy.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WARN = "\x1b[33m⚠\x1b[0m";
const OK   = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";

function label(pass, warn = false) {
  return pass ? OK : warn ? WARN : FAIL;
}

// ── 5.11: raw_articles growth — should see rows across multiple hours ──────────
async function checkScraper() {
  console.log("\n── article-scraper (5.11) ──────────────────────────────────");

  const { data, error } = await supabase.rpc("check_scraper_growth");
  // Fallback: raw SQL via a direct query
  const { data: rows, error: err } = await supabase
    .from("raw_articles")
    .select("scraped_at")
    .gte("scraped_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("scraped_at", { ascending: false });

  if (err) { console.log(`  ${FAIL} Query failed: ${err.message}`); return; }

  const total = rows.length;
  // Count distinct hours
  const hours = new Set(rows.map(r => new Date(r.scraped_at).getUTCHours())).size;

  console.log(`  ${label(total > 0)} Articles ingested (last 24h): ${total}`);
  console.log(`  ${label(hours >= 3)} Distinct hours with activity: ${hours} ${hours < 3 ? "(expect ≥3 if running >3h)" : ""}`);

  // Status breakdown
  const { data: statuses } = await supabase
    .from("raw_articles")
    .select("status")
    .gte("scraped_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (statuses) {
    const counts = {};
    for (const { status } of statuses) counts[status] = (counts[status] || 0) + 1;
    console.log("  Status breakdown:", counts);
  }
}

// ── 6.9: clusters — should populate on 2h cadence ─────────────────────────────
async function checkClusterer() {
  console.log("\n── article-clusterer (6.9) ─────────────────────────────────");

  const { data: clusters, error } = await supabase
    .from("clusters")
    .select("created_at, synthesis_queued_at")
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false });

  if (error) { console.log(`  ${FAIL} Query failed: ${error.message}`); return; }

  const total = clusters.length;
  const queued = clusters.filter(c => c.synthesis_queued_at).length;
  const hours = new Set(clusters.map(c => new Date(c.created_at).getUTCHours())).size;

  console.log(`  ${label(total > 0)} Clusters created (last 24h): ${total}`);
  console.log(`  ${label(hours >= 2)} Distinct hours with cluster activity: ${hours} ${hours < 2 ? "(expect ≥2 if running >4h)" : ""}`);
  console.log(`  ${label(queued > 0 || total === 0)} Clusters queued for synthesis: ${queued} / ${total}`);

  // Unclustered article backlog
  const { count } = await supabase
    .from("raw_articles")
    .select("id", { count: "exact", head: true })
    .is("clustered_at", null)
    .eq("status", "DONE");

  console.log(`  ${label(count < 500, count >= 500)} Unclustered DONE articles (backlog): ${count ?? "unknown"}`);
}

// ── 7.10: stories — should grow throughout the day ────────────────────────────
async function checkSynthesizer() {
  console.log("\n── story-synthesizer (7.10) ────────────────────────────────");

  const { data: stories, error } = await supabase
    .from("stories")
    .select("published_at, confidence_score")
    .gte("published_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("published_at", { ascending: false });

  if (error) { console.log(`  ${FAIL} Query failed: ${error.message}`); return; }

  const total = stories.length;
  const hours = new Set(stories.map(s => new Date(s.published_at).getUTCHours())).size;
  const avgConf = total > 0
    ? (stories.reduce((sum, s) => sum + (s.confidence_score ?? 0), 0) / total).toFixed(2)
    : "n/a";

  console.log(`  ${label(total >= 5)} Stories published (last 24h): ${total} ${total < 5 ? "(target ≥20 steady state)" : ""}`);
  console.log(`  ${label(hours >= 2)} Distinct hours with stories: ${hours}`);
  console.log(`  ${label(parseFloat(avgConf) >= 0.6 || avgConf === "n/a")} Avg confidence score: ${avgConf}`);

  // Most recent story
  if (stories.length > 0) {
    const latest = new Date(stories[0].published_at);
    const ageMin = Math.round((Date.now() - latest) / 60000);
    console.log(`  ${label(ageMin < 180, ageMin >= 180)} Most recent story: ${ageMin}min ago`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nPipeline health check — ${new Date().toUTCString()}`);
await checkScraper();
await checkClusterer();
await checkSynthesizer();
console.log("\nDone.\n");
process.exit(0);

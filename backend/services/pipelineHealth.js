// Shared pipeline health queries used by:
//   api/cron/pipeline-health.js       (Vercel cron — email report)
//   azure-functions/scripts/pipeline-health.js  (local CLI snapshot)

export async function countWhere(supabase, table, filters = {}) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) q = q.is(k, null);
    else            q = q.eq(k, v);
  }
  const { count } = await q;
  return count ?? 0;
}

export async function getRawArticles(supabase) {
  const [done, lowQuality, failed, partial, unclustered] = await Promise.all([
    countWhere(supabase, "raw_articles", { status: "DONE" }),
    countWhere(supabase, "raw_articles", { status: "LOW_QUALITY" }),
    countWhere(supabase, "raw_articles", { status: "FAILED" }),
    countWhere(supabase, "raw_articles", { status: "PARTIAL" }),
    supabase
      .from("raw_articles")
      .select("*", { count: "exact", head: true })
      .eq("status", "DONE")
      .is("clustered_at", null)
      .then(r => r.count ?? 0),
  ]);
  return { total: done + lowQuality + failed + partial, done, lowQuality, failed, partial, unclustered };
}

export async function getClusters(supabase) {
  const [processed, pending, processing, notQueued] = await Promise.all([
    countWhere(supabase, "clusters", { status: "PROCESSED" }),
    countWhere(supabase, "clusters", { status: "PENDING" }),
    countWhere(supabase, "clusters", { status: "PROCESSING" }),
    supabase
      .from("clusters")
      .select("*", { count: "exact", head: true })
      .eq("status", "PENDING")
      .is("synthesis_queued_at", null)
      .then(r => r.count ?? 0),
  ]);
  return { total: processed + pending + processing, processed, pending, stuckProcessing: processing, notQueued };
}

export async function getStories(supabase) {
  const ago = (days) => new Date(Date.now() - days * 86400 * 1000).toISOString();
  const [total, last24h, last7d, recentRows] = await Promise.all([
    supabase.from("stories").select("*", { count: "exact", head: true }).then(r => r.count ?? 0),
    supabase.from("stories").select("*", { count: "exact", head: true }).gte("published_at", ago(1)).then(r => r.count ?? 0),
    supabase.from("stories").select("*", { count: "exact", head: true }).gte("published_at", ago(7)).then(r => r.count ?? 0),
    supabase.from("stories").select("published_at").gte("published_at", ago(7)).order("published_at", { ascending: false }),
  ]);
  const byDay = {};
  for (const s of recentRows.data ?? []) {
    const day = s.published_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  const recentDays = Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);
  return { total, last24h, last7d, recentDays };
}

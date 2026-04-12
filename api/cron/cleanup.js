// Phase 7.1 — Vercel Cron Function: 7-day TTL cleanup
// Schedule: daily at 3AM UTC (set in vercel.json)
// Deletes DONE/FAILED/LOW_QUALITY rows older than 7 days from both tables.

import { createClient } from "@supabase/supabase-js";

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

const CUTOFF_DAYS = 7;
const TERMINAL_STATUSES = ["DONE", "FAILED", "LOW_QUALITY"];

export default async function handler(req, res) {
  if (
    process.env.CRON_SECRET &&
    req.headers["authorization"] !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = buildSupabase();
  const cutoff = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { error: articleErr, count: articlesDeleted } = await supabase
      .from("raw_articles")
      .delete({ count: "exact" })
      .in("status", TERMINAL_STATUSES)
      .lt("scraped_at", cutoff);

    if (articleErr) throw new Error(`raw_articles cleanup: ${articleErr.message}`);

    const { error: queueErr, count: queueDeleted } = await supabase
      .from("scrape_queue")
      .delete({ count: "exact" })
      .in("status", TERMINAL_STATUSES)
      .lt("discovered_at", cutoff);

    if (queueErr) throw new Error(`scrape_queue cleanup: ${queueErr.message}`);

    const summary = { articles_deleted: articlesDeleted ?? 0, queue_deleted: queueDeleted ?? 0 };
    console.log(JSON.stringify({ event: "cleanup_complete", cutoff, ...summary }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error(JSON.stringify({ event: "cleanup_fatal", error: err.message }));
    return res.status(500).json({ ok: false, error: err.message });
  }
}

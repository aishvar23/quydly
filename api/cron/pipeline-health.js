import { createClient } from "@supabase/supabase-js";
import { ServiceBusAdministrationClient } from "@azure/service-bus";
import { Resend } from "resend";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function countWhere(table, filters = {}) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) q = q.is(k, null);
    else            q = q.eq(k, v);
  }
  const { count } = await q;
  return count ?? 0;
}

async function getRawArticles() {
  const [done, lowQuality, failed, unclustered] = await Promise.all([
    countWhere("raw_articles", { status: "DONE" }),
    countWhere("raw_articles", { status: "LOW_QUALITY" }),
    countWhere("raw_articles", { status: "FAILED" }),
    supabase
      .from("raw_articles")
      .select("*", { count: "exact", head: true })
      .eq("status", "DONE")
      .is("clustered_at", null)
      .then(r => r.count ?? 0),
  ]);
  return { total: done + lowQuality + failed, done, lowQuality, failed, unclustered };
}

async function getClusters() {
  const [processed, pending, processing, notQueued] = await Promise.all([
    countWhere("clusters", { status: "PROCESSED" }),
    countWhere("clusters", { status: "PENDING" }),
    countWhere("clusters", { status: "PROCESSING" }),
    supabase
      .from("clusters")
      .select("*", { count: "exact", head: true })
      .eq("status", "PENDING")
      .is("synthesis_queued_at", null)
      .then(r => r.count ?? 0),
  ]);
  return { total: processed + pending + processing, processed, pending, stuckProcessing: processing, notQueued };
}

async function getStories() {
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

async function getQueues() {
  if (!process.env.AZURE_SERVICE_BUS_CONNECTION_STRING) return null;
  try {
    const admin = new ServiceBusAdministrationClient(process.env.AZURE_SERVICE_BUS_CONNECTION_STRING);
    const [scrape, synth] = await Promise.all([
      admin.getQueueRuntimeProperties("scrape-queue"),
      admin.getQueueRuntimeProperties("synthesize-queue"),
    ]);
    return {
      scrapeActive:  scrape.activeMessageCount,
      scrapeDlq:     scrape.deadLetterMessageCount,
      synthActive:   synth.activeMessageCount,
      synthDlq:      synth.deadLetterMessageCount,
    };
  } catch {
    return null;
  }
}

// ── Email builder ─────────────────────────────────────────────────────────────

function statusDot(ok) {
  return ok ? "🟢" : "🔴";
}

function buildEmail(art, clust, stor, queues, issues, date) {
  const recentDaysRows = stor.recentDays
    .map(([day, count]) => `<tr><td style="padding:4px 12px">${day}</td><td style="padding:4px 12px;text-align:right">${count}</td></tr>`)
    .join("");

  const queuesSection = queues ? `
    <tr><td colspan="2" style="padding:8px 12px 2px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Service Bus</td></tr>
    <tr><td style="padding:4px 12px">scrape-queue active</td><td style="padding:4px 12px;text-align:right">${queues.scrapeActive}</td></tr>
    <tr><td style="padding:4px 12px">scrape-queue DLQ ${statusDot(queues.scrapeDlq === 0)}</td><td style="padding:4px 12px;text-align:right">${queues.scrapeDlq}</td></tr>
    <tr><td style="padding:4px 12px">synthesize-queue active</td><td style="padding:4px 12px;text-align:right">${queues.synthActive}</td></tr>
    <tr><td style="padding:4px 12px">synthesize-queue DLQ ${statusDot(queues.synthDlq === 0)}</td><td style="padding:4px 12px;text-align:right">${queues.synthDlq}</td></tr>
  ` : `<tr><td colspan="2" style="padding:4px 12px;color:#aaa">Service Bus data unavailable</td></tr>`;

  const issuesBanner = issues.length === 0
    ? `<div style="background:#d1fae5;border-left:4px solid #10b981;padding:12px 16px;margin-bottom:24px;border-radius:4px">✅ All systems healthy</div>`
    : `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin-bottom:24px;border-radius:4px">
        <strong>⚠️ Issues detected</strong>
        <ul style="margin:8px 0 0;padding-left:20px">${issues.map(i => `<li>${i}</li>`).join("")}</ul>
       </div>`;

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 4px">Quydly Pipeline Health</h2>
  <p style="color:#888;margin:0 0 24px;font-size:14px">${date} · Daily report</p>

  ${issuesBanner}

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
    <tr style="background:#f5f5f5"><td colspan="2" style="padding:8px 12px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Raw Articles</td></tr>
    <tr><td style="padding:4px 12px">Total</td><td style="padding:4px 12px;text-align:right">${art.total.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">DONE</td><td style="padding:4px 12px;text-align:right">${art.done.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">LOW_QUALITY</td><td style="padding:4px 12px;text-align:right">${art.lowQuality}</td></tr>
    <tr><td style="padding:4px 12px">FAILED</td><td style="padding:4px 12px;text-align:right">${art.failed}</td></tr>
    <tr><td style="padding:4px 12px">Unclustered backlog ${statusDot(art.unclustered === 0)}</td><td style="padding:4px 12px;text-align:right">${art.unclustered}</td></tr>

    <tr style="background:#f5f5f5"><td colspan="2" style="padding:8px 12px 2px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Clusters</td></tr>
    <tr><td style="padding:4px 12px">Total</td><td style="padding:4px 12px;text-align:right">${clust.total.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">PROCESSED</td><td style="padding:4px 12px;text-align:right">${clust.processed.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">PENDING</td><td style="padding:4px 12px;text-align:right">${clust.pending}</td></tr>
    <tr><td style="padding:4px 12px">Stuck PROCESSING ${statusDot(clust.stuckProcessing === 0)}</td><td style="padding:4px 12px;text-align:right">${clust.stuckProcessing}</td></tr>
    <tr><td style="padding:4px 12px">Not queued for synthesis</td><td style="padding:4px 12px;text-align:right">${clust.notQueued}</td></tr>

    <tr style="background:#f5f5f5"><td colspan="2" style="padding:8px 12px 2px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Stories</td></tr>
    <tr><td style="padding:4px 12px">Total</td><td style="padding:4px 12px;text-align:right">${stor.total.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">Last 24h ${statusDot(stor.last24h > 0)}</td><td style="padding:4px 12px;text-align:right">${stor.last24h}</td></tr>
    <tr><td style="padding:4px 12px">Last 7d</td><td style="padding:4px 12px;text-align:right">${stor.last7d}</td></tr>

    <tr style="background:#f5f5f5"><td colspan="2" style="padding:8px 12px 2px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Stories by Day (last 7d)</td></tr>
    ${recentDaysRows}

    ${queuesSection}
  </table>

  <p style="font-size:12px;color:#aaa;margin:0">Quydly · automated daily report</p>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();

  const token = (req.headers.authorization ?? "").replace("Bearer ", "");
  if (token !== process.env.CRON_SECRET) return res.status(401).end();

  const [art, clust, stor, queues] = await Promise.all([
    getRawArticles(),
    getClusters(),
    getStories(),
    getQueues(),
  ]);

  const issues = [
    art.unclustered > 500        && `Clustering backlog: ${art.unclustered} articles`,
    art.failed > 0               && `${art.failed} articles in FAILED status`,
    clust.stuckProcessing > 0    && `${clust.stuckProcessing} clusters stuck in PROCESSING`,
    stor.last24h === 0           && "No stories synthesised in the last 24h",
    queues?.scrapeDlq   > 0     && `scrape-queue DLQ: ${queues.scrapeDlq} messages`,
    queues?.synthDlq    > 0     && `synthesize-queue DLQ: ${queues.synthDlq} messages`,
  ].filter(Boolean);

  const date = new Date().toISOString().slice(0, 10);
  const subject = issues.length === 0
    ? `✅ Quydly Pipeline — ${date} — All healthy`
    : `⚠️ Quydly Pipeline — ${date} — ${issues.length} issue${issues.length > 1 ? "s" : ""}`;

  await resend.emails.send({
    from: "Quydly Pipeline <noreply@quydly.com>",
    to:   "aishvar.suhane@gmail.com",
    subject,
    html: buildEmail(art, clust, stor, queues, issues, date),
  });

  return res.json({ ok: true, issues, date });
}

import { createClient } from "@supabase/supabase-js";
import { ServiceBusAdministrationClient } from "@azure/service-bus";
import { Resend } from "resend";
import { getRawArticles, getClusters, getStories } from "../../backend/services/pipelineHealth.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

async function getQueues() {
  if (!process.env.AZURE_SERVICE_BUS_CONNECTION_STRING) return null;
  try {
    const admin = new ServiceBusAdministrationClient(process.env.AZURE_SERVICE_BUS_CONNECTION_STRING);
    const [scrape, synth] = await Promise.all([
      admin.getQueueRuntimeProperties("scrape-queue"),
      admin.getQueueRuntimeProperties("synthesize-queue"),
    ]);
    return {
      scrapeActive: scrape.activeMessageCount,
      scrapeDlq:    scrape.deadLetterMessageCount,
      synthActive:  synth.activeMessageCount,
      synthDlq:     synth.deadLetterMessageCount,
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
    <tr><td style="padding:4px 12px">scrape-queue active<br><span style="font-size:11px;color:#aaa">URLs waiting to be scraped — should drain within minutes</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${queues.scrapeActive}</td></tr>
    <tr><td style="padding:4px 12px">scrape-queue DLQ ${statusDot(queues.scrapeDlq === 0)}<br><span style="font-size:11px;color:#aaa">failed scrapes after max retries — run peek-dlq.js to investigate</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${queues.scrapeDlq}</td></tr>
    <tr><td style="padding:4px 12px">synthesize-queue active<br><span style="font-size:11px;color:#aaa">clusters waiting to be turned into stories</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${queues.synthActive}</td></tr>
    <tr><td style="padding:4px 12px">synthesize-queue DLQ ${statusDot(queues.synthDlq === 0)}<br><span style="font-size:11px;color:#aaa">failed synthesis after max retries — run peek-dlq.js to investigate</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${queues.synthDlq}</td></tr>
  ` : `<tr><td colspan="2" style="padding:4px 12px;color:#aaa">Service Bus data unavailable — set AZURE_SERVICE_BUS_CONNECTION_STRING in Vercel env</td></tr>`;

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
    <tr><td style="padding:4px 12px">Total<br><span style="font-size:11px;color:#aaa">all articles ever scraped by the pipeline</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${art.total.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">DONE<br><span style="font-size:11px;color:#aaa">successfully scraped and content extracted</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${art.done.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">LOW_QUALITY<br><span style="font-size:11px;color:#aaa">scraped but content too thin, short, or paywalled</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${art.lowQuality}</td></tr>
    <tr><td style="padding:4px 12px">PARTIAL<br><span style="font-size:11px;color:#aaa">scraped but some content fields are missing</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${art.partial}</td></tr>
    <tr><td style="padding:4px 12px">FAILED<br><span style="font-size:11px;color:#aaa">scrape failed after all retries — check scraper logs</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${art.failed}</td></tr>
    <tr><td style="padding:4px 12px">Unclustered backlog ${statusDot(art.unclustered <= 500)}<br><span style="font-size:11px;color:#aaa">DONE articles not yet grouped into topic clusters — drains automatically every 2h; flag if >500</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${art.unclustered}</td></tr>

    <tr style="background:#f5f5f5"><td colspan="2" style="padding:8px 12px 2px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Clusters</td></tr>
    <tr><td style="padding:4px 12px">Total<br><span style="font-size:11px;color:#aaa">distinct topic clusters identified across all articles</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${clust.total.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">PROCESSED<br><span style="font-size:11px;color:#aaa">clusters that have been synthesised into stories</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${clust.processed.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">PENDING<br><span style="font-size:11px;color:#aaa">clusters eligible for synthesis, awaiting the synthesize-queue</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${clust.pending}</td></tr>
    <tr><td style="padding:4px 12px">Stuck PROCESSING ${statusDot(clust.stuckProcessing === 0)}<br><span style="font-size:11px;color:#aaa">clusters left mid-synthesis when pipeline died — need manual reset to PENDING</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${clust.stuckProcessing}</td></tr>
    <tr><td style="padding:4px 12px">Not queued for synthesis<br><span style="font-size:11px;color:#aaa">PENDING clusters not yet sent to the synthesize-queue — picked up on next clusterer run</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${clust.notQueued}</td></tr>

    <tr style="background:#f5f5f5"><td colspan="2" style="padding:8px 12px 2px;font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Stories</td></tr>
    <tr><td style="padding:4px 12px">Total<br><span style="font-size:11px;color:#aaa">synthesised stories ever produced by the pipeline</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${stor.total.toLocaleString()}</td></tr>
    <tr><td style="padding:4px 12px">Last 24h ${statusDot(stor.last24h > 0)}<br><span style="font-size:11px;color:#aaa">stories produced today — zero means the pipeline is stalled</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${stor.last24h}</td></tr>
    <tr><td style="padding:4px 12px">Last 7d<br><span style="font-size:11px;color:#aaa">weekly story output — useful for spotting multi-day gaps</span></td><td style="padding:4px 12px;text-align:right;vertical-align:top">${stor.last7d}</td></tr>

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
    getRawArticles(supabase),
    getClusters(supabase),
    getStories(supabase),
    getQueues(),
  ]);

  const issues = [
    art.unclustered > 500     && `Clustering backlog: ${art.unclustered} articles`,
    art.failed > 0            && `${art.failed} articles in FAILED status`,
    clust.stuckProcessing > 0 && `${clust.stuckProcessing} clusters stuck in PROCESSING`,
    stor.last24h === 0        && "No stories synthesised in the last 24h",
    queues === null           && "Service Bus telemetry unavailable — DLQ status unknown",
    queues?.scrapeDlq > 0    && `scrape-queue DLQ: ${queues.scrapeDlq} messages`,
    queues?.synthDlq  > 0    && `synthesize-queue DLQ: ${queues.synthDlq} messages`,
  ].filter(Boolean);

  const date = new Date().toISOString().slice(0, 10);
  const subject = issues.length === 0
    ? `✅ Quydly Pipeline — ${date} — All healthy`
    : `⚠️ Quydly Pipeline — ${date} — ${issues.length} issue${issues.length > 1 ? "s" : ""}`;

  const { error: sendError } = await resend.emails.send({
    from: "Quydly Pipeline <noreply@quydly.com>",
    to:   process.env.HEALTH_REPORT_EMAIL,
    subject,
    html: buildEmail(art, clust, stor, queues, issues, date),
  });

  if (sendError) {
    console.error("[pipeline-health] Resend error:", sendError);
    return res.status(500).json({ ok: false, error: sendError.message });
  }

  return res.json({ ok: true, issues, date });
}

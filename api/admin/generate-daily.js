import { generateDaily } from "../../backend/jobs/generateDaily.js";
import { tokenMatches } from "../../backend/lib/adminAuth.js";
import { VALID_AUDIENCES } from "../../backend/lib/audiences.js";

// POST /api/admin/generate-daily[?audience=india|global]
//
// Production (Vercel) twin of the Express admin route — the operator recovery
// trigger for a missed/failed 7AM quiz. Gated by ADMIN_TOKEN via the
// x-admin-token header (operator credential, distinct from the cron's
// CRON_SECRET). Runs generateDaily SILENT so a manual recovery never re-emails
// every subscriber.
//
// Unlike the Express route this AWAITS the pipeline: a Vercel serverless
// function is frozen once it responds, so fire-and-forget background work would
// be killed. Mirrors api/cron/generate-silent.js.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: "ADMIN_TOKEN is not configured on the server" });
  }
  if (!tokenMatches(req.headers["x-admin-token"])) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const rawAudience = req.query.audience;
  const audience = VALID_AUDIENCES.includes(rawAudience) ? rawAudience : "global";

  try {
    const questions = await generateDaily(audience, { silent: true });
    return res.json({ ok: true, count: questions.length, audience });
  } catch (err) {
    console.error("[POST /api/admin/generate-daily]", err.message);
    return res.status(500).json({ error: "Generation failed", message: err.message });
  }
}

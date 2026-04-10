// Phase 5.3 — Vercel Cron Function: processing worker
// Schedule: every 5 minutes, maxDuration: 60s (set in vercel.json)

import { runProcessing } from "../../backend/services/processor.js";

export default async function handler(req, res) {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-vercel-cron"] !== "1"
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const summary = await runProcessing();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error(JSON.stringify({ event: "process_cron_fatal", error: err.message }));
    return res.status(500).json({ ok: false, error: err.message });
  }
}

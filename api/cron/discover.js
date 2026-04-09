// Phase 4.2 — Vercel Cron Function: discovery
// Schedule: every 30 minutes (set in vercel.json)

import { runDiscovery } from "../../backend/services/discoverer.js";

export default async function handler(req, res) {
  // Vercel cron requests include this header; reject anything else in production
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-vercel-cron"] !== "1"
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const summary = await runDiscovery();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error(JSON.stringify({ event: "discover_cron_fatal", error: err.message }));
    return res.status(500).json({ ok: false, error: err.message });
  }
}

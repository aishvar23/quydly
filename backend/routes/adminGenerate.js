// Admin quiz-generation trigger.
//
// Manual "regenerate the daily quiz now" escape hatch for operators — used to
// recover from a failed/missed 7AM cron without waiting for the next day. This
// is the ONLY user-reachable way to invoke generateDaily; the user-facing
// GET /api/questions never generates live (it serves the latest DB row).
//
// The job is fired async and the request returns 202 immediately — generation
// can take minutes, so we never block the caller on it.
//
// Auth: the shared ADMIN_TOKEN (env), supplied via the x-admin-token header,
// matched with a constant-time compare (same convention as adminSocial.js).

import { Router } from "express";
import { generateDaily } from "../jobs/generateDaily.js";
import { tokenMatches } from "../lib/adminAuth.js";
import { VALID_AUDIENCES } from "../lib/audiences.js";

const router = Router();

function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({ error: "ADMIN_TOKEN is not configured on the server" });
  }
  if (tokenMatches(req.headers["x-admin-token"])) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// POST /api/admin/generate-daily[?audience=india|global]
// Fires the daily-quiz pipeline in the background and returns 202 immediately.
router.post("/generate-daily", requireAdmin, (req, res) => {
  const rawAudience = req.query.audience;
  const audience = VALID_AUDIENCES.includes(rawAudience) ? rawAudience : "global";

  // Fire-and-forget: never block the request on the multi-minute pipeline.
  // silent: true — this is a manual recovery trigger, not the scheduled 7AM
  // run, so it must NOT re-send the daily notification email to every user
  // (generateDaily emails when `audience === "global" && !silent`).
  generateDaily(audience, { silent: true })
    .then((questions) =>
      console.log(`[POST /api/admin/generate-daily] done (audience="${audience}", ${questions?.length ?? 0} questions)`),
    )
    .catch((err) =>
      console.error(`[POST /api/admin/generate-daily] failed (audience="${audience}"):`, err),
    );

  return res.status(202).json({ accepted: true, audience });
});

export default router;

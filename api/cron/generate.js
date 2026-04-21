import { generateDaily } from "../../backend/jobs/generateDaily.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify CRON_SECRET — Vercel sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const questions = await generateDaily("global", { enforceExecutionDeadline: true });
    return res.json({ ok: true, count: questions.length, date: new Date().toISOString().slice(0, 10) });
  } catch (err) {
    console.error("[cron/generate]", err.message);
    return res.status(500).json({ error: "Generation failed", message: err.message });
  }
}

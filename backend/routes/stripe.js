import { Router } from "express";

const router = Router();

// POST /api/webhook/stripe — STUB ONLY
router.post("/", (req, res) => {
  console.log("[stripe webhook] event received:", req.body?.type ?? "(unknown type)");
  res.sendStatus(200);
});

export default router;

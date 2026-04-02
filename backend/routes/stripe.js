const { Router } = require("express");

const router = Router();

// POST /api/webhook/stripe — STUB ONLY
// Scaffold only. Body: Stripe webhook event.
// Log the event. Return 200. Do not implement.
router.post("/", (req, res) => {
  console.log("[stripe webhook] event received:", req.body?.type ?? "(unknown type)");
  res.sendStatus(200);
});

module.exports = router;

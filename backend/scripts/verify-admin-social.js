// Isolated harness for the /admin/social route — mounts only adminSocialRouter
// so the full app's unrelated import-time deps (Resend, Stripe, etc.) aren't
// required. Env (SUPABASE_URL/SERVICE_KEY, ADMIN_TOKEN, PORT) comes from the
// shell. Usage: node backend/scripts/verify-admin-social.js
import express from "express";
import adminSocial from "../routes/adminSocial.js";

const app = express();
app.use("/admin/social", adminSocial);
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3939;
app.listen(PORT, () => console.log(`[verify-admin-social] listening on ${PORT}`));

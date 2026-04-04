import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

function buildAnonSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// POST /api/auth/signup
// Body: { email, password, name, age }
// Creates a Supabase Auth user and stores name + age in the users profile table.
// Returns { user: { id, email, name, age }, session }
router.post("/signup", async (req, res) => {
  const { email, password, name, age } = req.body ?? {};

  if (!email || !password || !name || age === undefined) {
    return res.status(400).json({ error: "Missing required fields: email, password, name, age" });
  }

  if (typeof age !== "number" || age < 1 || age > 120) {
    return res.status(400).json({ error: "age must be a number between 1 and 120" });
  }

  const anonClient = buildAnonSupabase();
  const { data, error } = await anonClient.auth.signUp({ email, password });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  const userId = data.user?.id;
  if (!userId) {
    return res.status(500).json({ error: "Signup succeeded but no user ID returned" });
  }

  // The on_auth_user_created trigger auto-inserts the users row.
  // Update it with name and age.
  const supabase = buildSupabase();
  const { error: updateErr } = await supabase
    .from("users")
    .update({ name, age })
    .eq("id", userId);

  if (updateErr) {
    return res.status(500).json({ error: "Failed to save profile details" });
  }

  return res.status(201).json({
    user: { id: userId, email: data.user.email, name, age },
    session: data.session,
  });
});

export default router;

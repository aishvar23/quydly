// Phase 6.1 — Article store (replaces newsdata.js)
// Queries raw_articles for verified, recent, high-quality articles by category.

import { createClient } from "@supabase/supabase-js";

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

/**
 * Fetch a usable story for generateDaily.js.
 * Returns { title, description } or throws if none available.
 * Mirrors the interface of newsdata.js fetchHeadline().
 */
export async function fetchStoriesForCategory(category_id) {
  const supabase = buildSupabase();

  const { data, error } = await supabase
    .from("raw_articles")
    .select("title, description")
    .eq("category_id", category_id)
    .eq("is_verified", true)
    .eq("status", "DONE")
    .gte("published_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
    .order("authority_score", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`articleStore query failed for "${category_id}": ${error.message}`);
  }

  const articles = (data ?? []).filter((a) => a.title && a.description);
  if (articles.length === 0) {
    throw new Error(`No verified articles available for category "${category_id}"`);
  }

  // Return the top result (highest authority, most recent)
  return { title: articles[0].title, description: articles[0].description };
}

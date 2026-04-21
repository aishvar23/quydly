// Phase 6.1 — Article store (replaces newsdata.js)
// Queries raw_articles for verified, recent, high-quality articles by category.

import { createClient } from "@supabase/supabase-js";

const AUDIENCE_COUNTRY_CODE = { india: "in" };

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
  const pool = await fetchArticlePool(category_id);
  return pool[0];
}

/**
 * Fetch geo-weighted story pools for an audience (tasks 8.2, 8.3, 8.5).
 *
 * Returns three arrays (A/B/C) sized to fill totalNeeded slots at the
 * 60/25/15 mix, plus a totalAvailable count for the fallback check.
 *
 * Pool A (heroBuckets %): hero/standard rank_bucket + country in primary_geos
 * Pool B (globalSigIndia %): high global_significance_score + country in primary_geos, not in A
 * Pool C (globalOnly %): top global_significance_score globally, not in A or B
 *
 * Each item has shape { title, description, category_id } matching the
 * interface that generateQuestion() already expects.
 */
export async function fetchAudienceStoryPools(audience, supabase, totalNeeded, mixConfig) {
  const audienceMix   = mixConfig[audience];
  const heroTarget    = Math.ceil(totalNeeded * audienceMix.heroBuckets);
  const globalIndiaTarget = Math.ceil(totalNeeded * audienceMix.globalSigIndia);
  const globalOnlyTarget  = Math.max(0, totalNeeded - heroTarget - globalIndiaTarget);
  const threshold     = audienceMix.globalSigThreshold;
  const countryCode   = AUDIENCE_COUNTRY_CODE[audience];

  // Overfetch all audience-ranked rows so JS bucketing has enough to work with
  const { data: audRows, error: audErr } = await supabase
    .from("story_audiences")
    .select(
      "story_id, relevance_score, rank_bucket, rank_priority, " +
      "stories(id, headline, summary, key_points, confidence_score, source_count, category_id, primary_geos, global_significance_score)"
    )
    .eq("audience_geo", audience)
    .order("rank_priority", { ascending: true })
    .order("relevance_score", { ascending: false })
    .limit(300);

  if (audErr) throw new Error(`story_audiences fetch (${audience}): ${audErr.message}`);

  const rows = (audRows ?? []).filter((r) => r.stories);

  // Pool A: hero/standard + country in primary_geos
  const poolA = rows
    .filter(
      (r) =>
        ["hero", "standard"].includes(r.rank_bucket) &&
        Array.isArray(r.stories.primary_geos) &&
        r.stories.primary_geos.includes(countryCode)
    )
    .map((r) => storyToArticle(r.stories));

  const poolAIds = new Set(poolA.map((s) => s._story_id));

  // Pool B: high global_sig + country in primary_geos, not already in A
  const poolB = rows
    .filter(
      (r) =>
        !poolAIds.has(r.story_id) &&
        Array.isArray(r.stories.primary_geos) &&
        r.stories.primary_geos.includes(countryCode) &&
        (r.stories.global_significance_score ?? 0) >= threshold
    )
    .sort((a, b) => (b.stories.global_significance_score ?? 0) - (a.stories.global_significance_score ?? 0))
    .map((r) => storyToArticle(r.stories));

  const poolBIds = new Set(poolB.map((s) => s._story_id));

  // Pool C: globally significant stories not in A or B (fetch directly from stories)
  let poolC = [];
  if (globalOnlyTarget > 0) {
    const excludeIds = [...poolAIds, ...poolBIds];
    let query = supabase
      .from("stories")
      .select("id, headline, summary, category_id, global_significance_score")
      .gte("global_significance_score", threshold)
      .order("global_significance_score", { ascending: false })
      .limit(globalOnlyTarget + 20);

    if (excludeIds.length > 0) {
      query = query.not("id", "in", `(${excludeIds.join(",")})`);
    }

    const { data: cRows, error: cErr } = await query;
    if (cErr) {
      console.warn(`[articleStore] Pool C fetch failed: ${cErr.message}`);
    } else {
      poolC = (cRows ?? []).map(storyToArticle);
    }
  }

  // Fallback threshold counts only story_audiences rows (A + B).
  // Pool C comes from stories directly and can be large even on day one,
  // which would mask a sparse story_audiences and bypass the intended fallback.
  const audienceRowCount = poolA.length + poolB.length;

  return {
    poolA: poolA.slice(0, heroTarget + 20),       // overfetch for category distribution
    poolB: poolB.slice(0, globalIndiaTarget + 10),
    poolC: poolC.slice(0, globalOnlyTarget + 10),
    totalAvailable: audienceRowCount,
  };
}

function storyToArticle(story) {
  return {
    title:            story.headline,
    description:      story.summary,
    key_points:       Array.isArray(story.key_points) ? story.key_points : [],
    confidence_score: story.confidence_score,
    source_count:     story.source_count,
    category_id:      story.category_id,
    _story_id:        story.id,
  };
}

/**
 * Fetch synthesized stories for a category (up to 10), sorted by story_score.
 * Returns [] (not throws) when no stories exist — caller falls back to fetchArticlePool.
 *
 * Only returns verified stories with confidence_score >= 6 updated within 24h,
 * matching the quiz generation eligibility rules from the gold-set pipeline design.
 */
export async function fetchStoryPool(category_id, limit = 10) {
  const supabase = buildSupabase();

  const { data, error } = await supabase
    .from("stories")
    .select("headline, summary, key_points, confidence_score, source_count")
    .eq("category_id", category_id)
    .eq("quiz_candidate", true)
    .gte("confidence_score", 6)
    .gte("updated_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("quizability_score", { ascending: false })
    .order("story_score", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn(`[articleStore] fetchStoryPool failed for "${category_id}": ${error.message}`);
    return [];
  }

  return (data ?? [])
    .filter((s) => s.headline && s.summary)
    .map((s) => ({
      title:            s.headline,
      description:      s.summary,
      key_points:       Array.isArray(s.key_points) ? s.key_points : [],
      confidence_score: s.confidence_score,
      source_count:     s.source_count,
    }));
}

/**
 * Fetch a pool of usable stories for a category (up to 10).
 * Returns an array of { title, description } sorted by authority then recency.
 * Throws if no articles are available.
 */
export async function fetchArticlePool(category_id, limit = 10) {
  const supabase = buildSupabase();

  const { data, error } = await supabase
    .from("raw_articles")
    .select("title, description")
    .eq("category_id", category_id)
    .eq("is_verified", true)
    .eq("status", "DONE")
    .gte("published_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("authority_score", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`articleStore query failed for "${category_id}": ${error.message}`);
  }

  const articles = (data ?? []).filter((a) => a.title && a.description);
  if (articles.length === 0) {
    throw new Error(`No verified articles available for category "${category_id}"`);
  }

  return articles;
}

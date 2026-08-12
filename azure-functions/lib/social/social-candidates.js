// Social candidate selection logic (Phase 1).
//
// Decides which synthesized stories become social_publication_candidates, one row
// per (story, audience_geo). Splits cleanly into:
//   - buildEligiblePairs(...)  pure: filtering, dedupe, per-geo daily cap, ordering
//   - selectEligibleStories(...) fetches the inputs, then calls the pure helper
//   - insertCandidate(...)     idempotent insert (UNIQUE(story_id, audience_geo))
//   - buildPublishReason(...)  pure: human-readable selection reason
//
// Reference: design doc §7.1 (candidate selection rules + pseudocode).

import { classifySensitivity } from "./social-safety.js";

// Columns the selector needs from `stories` (sensitivity scan + snapshot fields).
const STORY_COLUMNS =
  "id, headline, summary, category_id, story_score, confidence_score, " +
  "source_count, source_documents, published_at, key_points, hook_sentence, why_it_matters";

const STORY_FETCH_LIMIT = 500; // bounded scan; cap is applied per-geo afterwards

function startOfUtcDayIso(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function pairKey(storyId, audienceGeo) {
  return `${storyId}::${audienceGeo}`;
}

// Pure: map a story category_id to its weight-group name.
// Any category not listed in a group falls into `defaultGroup` (catch-all).
export function groupForCategory(categoryId, categoryWeights) {
  const groups = categoryWeights?.groups || {};
  for (const [name, group] of Object.entries(groups)) {
    if ((group.categories || []).includes(categoryId)) return name;
  }
  return categoryWeights?.defaultGroup || null;
}

// Pick the next weight-group to draw from: highest D'Hondt quotient
// weight/(used+1) among groups that still have eligible pairs. Ties break on
// higher raw weight, then group declaration order (deterministic). Groups with
// no candidates are skipped entirely, so an empty bucket's share redistributes
// proportionally to the rest instead of stalling selection.
function pickNextGroup(queues, groups, used) {
  let best = null;
  let bestQ = -1;
  let bestW = -1;
  for (const [name, queue] of queues) {
    if (queue.length === 0) continue;
    const weight = Number(groups[name]?.weight) || 0;
    const q = weight / ((used[name] || 0) + 1);
    if (q > bestQ || (q === bestQ && weight > bestW)) {
      best = name;
      bestQ = q;
      bestW = weight;
    }
  }
  return best;
}

// Pure: given fetched data, return the ordered list of eligible (story, geo) pairs
// to create, excluding existing candidates and respecting the per-geo daily cap.
//
//   audiences        [{ story_id, audience_geo, relevance_score }]
//   storyById        Map<story_id, storyRow>
//   existingKeys     Set<"storyId::geo"> already-present candidates
//   countsByGeo      { [geo]: number } candidates already created today for that geo
//   cap              max candidates per day per geo (daily ceiling)
//   perRunCap        max candidates to create per geo in THIS run (drip across the
//                    day via the hourly cadence). Defaults to no limit.
//   categoryWeights  optional FLAGS.social.categoryWeights. When enabled, slots
//                    within each geo are allocated by deterministic weighted
//                    round-robin (D'Hondt) across category groups instead of pure
//                    score order. Within a group, score order still decides.
//   groupCountsByGeo { [geo]: { [group]: number } } today's already-created
//                    candidates per group — seeds the round-robin so the daily
//                    mix converges on the weights even at 1 candidate per run.
export function buildEligiblePairs({
  audiences,
  storyById,
  existingKeys,
  countsByGeo,
  cap,
  perRunCap = Infinity,
  categoryWeights = null,
  groupCountsByGeo = {},
}) {
  const eligible = (audiences || [])
    .filter((a) => storyById.has(a.story_id))
    .filter((a) => !existingKeys.has(pairKey(a.story_id, a.audience_geo)))
    .map((a) => ({
      story: storyById.get(a.story_id),
      audienceGeo: a.audience_geo,
      relevanceScore: a.relevance_score,
    }));

  // ORDER BY audience_geo, relevance_score desc, story_score desc (design §7.1).
  eligible.sort((x, y) => {
    if (x.audienceGeo !== y.audienceGeo) return x.audienceGeo < y.audienceGeo ? -1 : 1;
    if (y.relevanceScore !== x.relevanceScore) return y.relevanceScore - x.relevanceScore;
    return Number(y.story.story_score) - Number(x.story.story_score);
  });

  // Bucket per geo, preserving the score ordering within each geo.
  const byGeo = new Map();
  for (const pair of eligible) {
    if (!byGeo.has(pair.audienceGeo)) byGeo.set(pair.audienceGeo, []);
    byGeo.get(pair.audienceGeo).push(pair);
  }

  const weighted = Boolean(categoryWeights?.enabled && categoryWeights.groups);
  const selected = [];

  for (const [geo, pairs] of byGeo) {
    let slots = Math.min(Math.max(0, cap - (countsByGeo[geo] || 0)), perRunCap);
    if (slots <= 0) continue;

    if (!weighted) {
      // Legacy behaviour: pure score order.
      selected.push(...pairs.slice(0, slots));
      continue;
    }

    // Group queues, declared groups first so tie-breaks are deterministic.
    const queues = new Map(Object.keys(categoryWeights.groups).map((g) => [g, []]));
    for (const pair of pairs) {
      const g = groupForCategory(pair.story.category_id || pair.story.category, categoryWeights);
      if (!queues.has(g)) queues.set(g, []);
      queues.get(g).push(pair);
    }

    const used = { ...(groupCountsByGeo[geo] || {}) };
    while (slots > 0) {
      const g = pickNextGroup(queues, categoryWeights.groups, used);
      if (!g) break; // no eligible pairs left in any group
      selected.push(queues.get(g).shift());
      used[g] = (used[g] || 0) + 1;
      slots--;
    }
  }
  return selected;
}

// Fetch inputs from Supabase and return the eligible (story, geo) pairs to create.
export async function selectEligibleStories(supabase, { now = new Date(), flags }) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const sinceIso = new Date(nowMs - flags.freshnessHours * 60 * 60 * 1000).toISOString();

  // 1. Candidate stories: fresh + score/confidence floors.
  let query = supabase
    .from("stories")
    .select(STORY_COLUMNS)
    .gte("published_at", sinceIso)
    .gte("story_score", flags.minStoryScore)
    .gte("confidence_score", flags.minConfidence);

  // Verticals with their own dedicated handles (e.g. `ai`) must never post to the
  // existing accounts. Excluded here at the source so they can't become candidates.
  const excludeCategories = flags.excludeCategories || [];
  if (excludeCategories.length) {
    query = query.not("category_id", "in", `(${excludeCategories.join(",")})`);
  }

  const { data: stories, error: storyErr } = await query
    .order("story_score", { ascending: false })
    .limit(STORY_FETCH_LIMIT);

  if (storyErr) throw new Error(`[social-candidates] fetch stories: ${storyErr.message}`);
  if (!stories || stories.length === 0) return [];

  const storyById = new Map(stories.map((s) => [s.id, s]));
  const storyIds = stories.map((s) => s.id);

  // 2. Audience projections meeting the relevance floor.
  const { data: audiences, error: audErr } = await supabase
    .from("story_audiences")
    .select("story_id, audience_geo, relevance_score")
    .in("story_id", storyIds)
    .gte("relevance_score", flags.minRelevance);

  if (audErr) throw new Error(`[social-candidates] fetch story_audiences: ${audErr.message}`);
  if (!audiences || audiences.length === 0) return [];

  // 3. Existing candidates for these stories (dedupe on story_id + audience_geo).
  const { data: existing, error: existErr } = await supabase
    .from("social_publication_candidates")
    .select("story_id, audience_geo")
    .in("story_id", storyIds);

  if (existErr) throw new Error(`[social-candidates] fetch existing candidates: ${existErr.message}`);

  const existingKeys = new Set((existing || []).map((c) => pairKey(c.story_id, c.audience_geo)));

  // 4. Today's per-geo counts for the daily cap, plus per-group counts (the
  //    candidate row stores the story's category) to seed the category-mix
  //    round-robin so the daily mix converges on the configured weights.
  const { data: todays, error: todayErr } = await supabase
    .from("social_publication_candidates")
    .select("audience_geo, category")
    .gte("selected_at", startOfUtcDayIso(now));

  if (todayErr) throw new Error(`[social-candidates] fetch today's counts: ${todayErr.message}`);

  const categoryWeights = flags.categoryWeights || null;
  const countsByGeo = {};
  const groupCountsByGeo = {};
  for (const row of todays || []) {
    countsByGeo[row.audience_geo] = (countsByGeo[row.audience_geo] || 0) + 1;
    if (categoryWeights?.enabled) {
      const g = groupForCategory(row.category, categoryWeights);
      if (g) {
        const geoGroups = groupCountsByGeo[row.audience_geo] || (groupCountsByGeo[row.audience_geo] = {});
        geoGroups[g] = (geoGroups[g] || 0) + 1;
      }
    }
  }

  return buildEligiblePairs({
    audiences,
    storyById,
    existingKeys,
    countsByGeo,
    cap: flags.maxCandidatesPerDayPerGeo,
    perRunCap: flags.maxCandidatesPerRunPerGeo ?? Infinity,
    categoryWeights,
    groupCountsByGeo,
  });
}

// Pure: compact, auditable reason string stored on the candidate row.
export function buildPublishReason(story, relevanceScore, sensitivityLevel) {
  const category = story.category_id || story.category || "uncategorized";
  return (
    `auto-selected · ${category} · score=${story.story_score} ` +
    `conf=${story.confidence_score} rel=${relevanceScore} ` +
    `sources=${story.source_count ?? "?"} sensitivity=${sensitivityLevel}`
  );
}

// Pure: decide the initial candidate status.
//
// ⚠️ UNGATED MODE (owner decision 2026-05-31): when auto-publish is enabled,
// EVERY candidate is AUTO_APPROVED — no sensitivity / category / quality gate.
// This means sensitive stories (war/crime/death/etc.) auto-post unattended.
// The §10.3 safety gate (`evaluateAutoApproval`) is intentionally NOT called
// here; it remains in social-safety.js so it can be re-enabled by restoring the
// commented line below.
//
// `autoRemaining` is the ONLY remaining limiter — a per-day ceiling kept solely
// to avoid tripping X's anti-spam limits (which would suspend the account), not
// a content filter. Off by default: autoEnabled=false unless SOCIAL_AUTO_PUBLISH_ENABLED.
export function decideCandidateStatus(story, { autoEnabled, autoFlags: _autoFlags, autoRemaining }) {
  if (!autoEnabled || autoRemaining <= 0) return "PENDING";
  // Re-enable the safety gate by uncommenting (and rename _autoFlags → autoFlags):
  // const { eligible } = evaluateAutoApproval(story, { flags: _autoFlags });
  // return eligible ? "AUTO_APPROVED" : "PENDING";
  return "AUTO_APPROVED";
}

// Idempotent insert. Returns { id, status } for a freshly inserted candidate, or
// null if one already existed for (story_id, audience_geo) (UNIQUE conflict).
// `status` defaults to PENDING (review-first); the selector passes AUTO_APPROVED
// for stories that clear the Phase 5 gate within the daily cap.
export async function insertCandidate(supabase, pair, { status = "PENDING" } = {}) {
  const { story, audienceGeo, relevanceScore } = pair;
  const sensitivityLevel = classifySensitivity(story);

  const { data, error } = await supabase
    .from("social_publication_candidates")
    .upsert(
      {
        story_id: story.id,
        audience_geo: audienceGeo,
        publish_reason: buildPublishReason(story, relevanceScore, sensitivityLevel),
        story_score: story.story_score,
        relevance_score: relevanceScore,
        confidence_score: story.confidence_score,
        category: story.category_id || story.category || null,
        sensitivity_level: sensitivityLevel,
        status,
      },
      { onConflict: "story_id,audience_geo", ignoreDuplicates: true }
    )
    .select("id, status")
    .maybeSingle();

  if (error) throw new Error(`[social-candidates] insert candidate: ${error.message}`);
  return data || null; // null → already existed, caller should skip enqueue
}

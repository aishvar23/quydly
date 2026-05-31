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

import { classifySensitivity, evaluateAutoApproval } from "./social-safety.js";

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

// Pure: given fetched data, return the ordered list of eligible (story, geo) pairs
// to create, excluding existing candidates and respecting the per-geo daily cap.
//
//   audiences      [{ story_id, audience_geo, relevance_score }]
//   storyById      Map<story_id, storyRow>
//   existingKeys   Set<"storyId::geo"> already-present candidates
//   countsByGeo    { [geo]: number } candidates already created today for that geo
//   cap            max candidates per day per geo
export function buildEligiblePairs({ audiences, storyById, existingKeys, countsByGeo, cap }) {
  const remaining = { ...countsByGeo };

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

  const selected = [];
  for (const pair of eligible) {
    const used = remaining[pair.audienceGeo] || 0;
    if (used >= cap) continue;
    remaining[pair.audienceGeo] = used + 1;
    selected.push(pair);
  }
  return selected;
}

// Fetch inputs from Supabase and return the eligible (story, geo) pairs to create.
export async function selectEligibleStories(supabase, { now = new Date(), flags }) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const sinceIso = new Date(nowMs - flags.freshnessHours * 60 * 60 * 1000).toISOString();

  // 1. Candidate stories: fresh + score/confidence floors.
  const { data: stories, error: storyErr } = await supabase
    .from("stories")
    .select(STORY_COLUMNS)
    .gte("published_at", sinceIso)
    .gte("story_score", flags.minStoryScore)
    .gte("confidence_score", flags.minConfidence)
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

  // 4. Today's per-geo counts for the daily cap.
  const { data: todays, error: todayErr } = await supabase
    .from("social_publication_candidates")
    .select("audience_geo")
    .gte("selected_at", startOfUtcDayIso(now));

  if (todayErr) throw new Error(`[social-candidates] fetch today's counts: ${todayErr.message}`);

  const countsByGeo = {};
  for (const row of todays || []) {
    countsByGeo[row.audience_geo] = (countsByGeo[row.audience_geo] || 0) + 1;
  }

  return buildEligiblePairs({
    audiences,
    storyById,
    existingKeys,
    countsByGeo,
    cap: flags.maxCandidatesPerDayPerGeo,
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

// Pure: decide the initial candidate status (Phase 5). Returns 'AUTO_APPROVED'
// only when auto-publish is enabled, a per-day budget remains, AND the story
// clears the §10.3 auto-approval gate. Otherwise 'PENDING' (human review).
// Off by default: callers pass autoEnabled=false unless SOCIAL_AUTO_PUBLISH_ENABLED.
export function decideCandidateStatus(story, { autoEnabled, autoFlags, autoRemaining }) {
  if (!autoEnabled || !autoFlags || autoRemaining <= 0) return "PENDING";
  const { eligible } = evaluateAutoApproval(story, { flags: autoFlags });
  return eligible ? "AUTO_APPROVED" : "PENDING";
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

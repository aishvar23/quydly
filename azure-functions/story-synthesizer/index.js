// Azure Service Bus Function: story-synthesizer
// Trigger: synthesize-queue message
//
// Per-message: receives { cluster_id, category_id }, runs two-pass Claude API,
// applies quality gates, and upserts a story via the River model.
//
// Idempotency: if cluster.status !== 'PENDING' at entry, complete and return.
// Claude errors: throw — SB retries up to maxDeliveryCount=3 before dead-lettering.
//
// autoComplete: true (host.json) — return normally = complete, throw = abandon.
// Internal concurrency: p-limit(3) applied via host.json maxConcurrentCalls=8;
//   actual Claude concurrency is bounded by the 3 concurrent instances limit in
//   the synthesizer logic below (mirroring backend/engine/synthesizer.js).

import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "../lib/clients.js";
import { computeStoryScore, storyDisposition } from "../lib/scoring.js";
import { AUDIENCES, computeAudienceProjection } from "../lib/geo.js";

const MODEL             = "claude-sonnet-4-20250514";
const MAX_RETRIES       = 2;
const CONTENT_TRUNCATE  = 500;
const RIVER_WINDOW_MS   = 24 * 60 * 60 * 1000;

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

// ── Claude passes (identical prompts to backend/engine/synthesizer.js) ────────

async function extractFacts(ai, articles) {
  const articleBlocks = articles
    .map((a, i) => {
      const body = [a.title, a.description, a.content ? a.content.slice(0, CONTENT_TRUNCATE) : null]
        .filter(Boolean)
        .join(" ");
      return `[Article ${i + 1} — ${a.domain}]\n${body}`;
    })
    .join("\n\n");

  const prompt = `You are a fact extractor for a news synthesis engine.

Extract key facts from these ${articles.length} articles about the same story.
For each fact, count how many articles mention or imply it (source_count).

${articleBlocks}

Respond ONLY with a valid JSON array, no markdown fences:
[
  { "fact": "...", "type": "event|statistic|quote|background", "source_count": <number> },
  ...
]

Rules:
- Extract 5–15 facts.
- type values: "event" (something happened), "statistic" (number/data point), "quote" (attributed statement), "background" (context).
- source_count = number of the above articles that mention or imply this fact.`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let facts;
  try {
    facts = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 1 invalid JSON: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(facts)) throw new Error("Pass 1: expected a JSON array of facts");
  return facts;
}

async function generateNarrative(ai, cluster, facts) {
  const factsText = facts
    .map(f => `- [${f.type}] ${f.fact}  (sources: ${f.source_count})`)
    .join("\n");

  const prompt = `You are a news editor synthesising a story for a daily news quiz.

Topic entities: ${cluster.primary_entities.join(", ")}
Category: ${cluster.category_id}
Source articles: ${cluster.article_ids.length}

Extracted facts:
${factsText}

Respond ONLY with valid JSON, no markdown fences:
{
  "headline": "...",
  "summary": "...",
  "key_points": ["...", "...", "..."],
  "confidence_score": <number 1–10>
}

Rules:
- headline: declarative statement, 10–15 words, no question marks.
- summary: 2–3 factual sentences.
- key_points: exactly 3–5 strings, each one crisp takeaway from this story.
- confidence_score: 1 = speculation / single source, 10 = confirmed by multiple independent sources.`;

  const msg = await ai.messages.create({
    model:      MODEL,
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 2 invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (
    typeof result.headline       !== "string" ||
    typeof result.summary        !== "string" ||
    !Array.isArray(result.key_points)          ||
    typeof result.confidence_score !== "number"
  ) {
    throw new Error(`Pass 2 missing required fields; got: ${Object.keys(result).join(", ")}`);
  }

  return result;
}

// ── Global significance score (design §7.2) ───────────────────────────────────

function computeGlobalSignificance(cluster, synthesis, articles) {
  const uniqueDomains = Math.min(6, (cluster.unique_domains ?? []).length);
  const allMentionedGeos = new Set();
  for (const a of articles) {
    for (const g of a.mentioned_geos ?? []) allMentionedGeos.add(g);
  }
  const geoDiversity = Math.min(5, allMentionedGeos.size);
  const maxAuthority = articles.reduce(
    (max, a) => Math.max(max, Number(a.authority_score ?? 0)),
    0,
  );
  return Number((
    2 * uniqueDomains +
    3 * geoDiversity +
    2 * maxAuthority +
    2 * synthesis.confidence_score
  ).toFixed(2));
}

// ── River model: find existing story to merge ─────────────────────────────────

async function findExistingStory(supabase, cluster, riverCutoff) {
  // Strategy 1: same cluster_id
  const { data: byCluster, error: e1 } = await supabase
    .from("stories")
    .select("id, primary_entities, key_points, updated_at")
    .eq("cluster_id", cluster.id)
    .gte("updated_at", riverCutoff)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e1) {
    throw new Error(`river lookup (cluster_id): ${e1.message}`);
  }
  if (byCluster) return byCluster;

  // Strategy 2: entity overlap in same category
  const { data: candidates, error: e2 } = await supabase
    .from("stories")
    .select("id, primary_entities, key_points, updated_at")
    .eq("category_id", cluster.category_id)
    .gte("updated_at", riverCutoff)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (e2) {
    throw new Error(`river lookup (entity overlap): ${e2.message}`);
  }
  if (!candidates || candidates.length === 0) return null;

  let best = null, bestOverlap = 0;
  for (const story of candidates) {
    const storyEntities = Array.isArray(story.primary_entities) ? story.primary_entities : [];
    const overlap = cluster.primary_entities.filter(e => storyEntities.includes(e)).length;
    if (overlap >= 2 && overlap > bestOverlap) {
      best        = story;
      bestOverlap = overlap;
    }
  }

  return best;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function storySynthesizer(context, message) {
  const { cluster_id } = message;

  const supabase = getSupabase();
  const ai       = getAnthropic();

  // ── 1. Fetch cluster — idempotency check ─────────────────────────────────
  const { data: cluster, error: clusterErr } = await supabase
    .from("clusters")
    .select("id, category_id, primary_entities, article_ids, unique_domains, cluster_score, status, primary_geos, geo_scores, source_countries")
    .eq("id", cluster_id)
    .single();

  if (clusterErr) {
    throw new Error(`[story-synthesizer] fetch cluster ${cluster_id}: ${clusterErr.message}`);
  }

  if (!cluster || cluster.status !== "PENDING") {
    // Already processed by a prior or duplicate message — complete and return.
    context.log(JSON.stringify({
      event:      "cluster_not_pending",
      cluster_id,
      status:     cluster?.status ?? "not_found",
    }));
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // ── 2. Mark PROCESSING so concurrent duplicates see non-PENDING ──────────
  await supabase
    .from("clusters")
    .update({ status: "PROCESSING", updated_at: new Date().toISOString() })
    .eq("id", cluster_id);

  // ── 3. Fetch article content ──────────────────────────────────────────────
  const { data: articles, error: artErr } = await supabase
    .from("raw_articles")
    .select("id, title, description, content, domain, mentioned_geos, source_country, geo_scores, authority_score")
    .in("id", cluster.article_ids);

  if (artErr) {
    // Reset to PENDING — next SB retry can try again
    await supabase
      .from("clusters")
      .update({ status: "PENDING", updated_at: new Date().toISOString() })
      .eq("id", cluster_id);
    throw new Error(`[story-synthesizer] fetch articles for cluster ${cluster_id}: ${artErr.message}`);
  }

  if (!articles || articles.length === 0) {
    context.log.warn(JSON.stringify({ event: "no_articles", cluster_id }));
    await supabase
      .from("clusters")
      .update({ status: "PROCESSED", updated_at: new Date().toISOString() })
      .eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // ── 4a. Phase A: Claude API calls (with retry) ────────────────────────────
  let facts, narrative, lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      facts     = await extractFacts(ai, articles);
      narrative = await generateNarrative(ai, cluster, facts);
      lastErr   = null;
      break;
    } catch (err) {
      lastErr = err;
      context.log.error(JSON.stringify({
        event:      "synthesis_attempt_failed",
        cluster_id,
        attempt,
        error:      err.message,
      }));
    }
  }

  if (lastErr) {
    // All retries exhausted — throw so SB retries (up to maxDeliveryCount=3)
    throw lastErr;
  }

  // ── 4b. Phase B: quality gates + River lookup + DB write ─────────────────
  const now = new Date().toISOString();

  // Quality gate: confidence
  if (narrative.confidence_score < 6) {
    context.log(JSON.stringify({ event: "LOW_CONFIDENCE", cluster_id, confidence: narrative.confidence_score }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Quality gate: key_points completeness
  if (narrative.key_points.length < 3) {
    context.log(JSON.stringify({ event: "LOW_KEY_POINTS", cluster_id, count: narrative.key_points.length }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Scoring
  const synthesisResult = { ...narrative, facts };
  const { story_score, consistency_score, source_count } = computeStoryScore(cluster, synthesisResult);
  const disposition = storyDisposition(story_score);

  if (disposition === "reject") {
    context.log(JSON.stringify({ event: "LOW_STORY_SCORE", cluster_id, story_score, disposition }));
    await supabase.from("clusters").update({ status: "PROCESSED", updated_at: now }).eq("id", cluster_id);
    // Return normally → runtime auto-completes the SB message
    return;
  }

  // Geo metadata for story
  const globalSignificanceScore = computeGlobalSignificance(cluster, narrative, articles);
  const storyPrimaryGeos = cluster.primary_geos ?? [];
  const storyGeoScores   = cluster.geo_scores   ?? {};

  // Extras for computeAudienceProjection (india_article_fraction requires article-level data)
  const indianArticleCount    = articles.filter(a => a.source_country === "in").length;
  const indianArticleFraction = articles.length > 0 ? indianArticleCount / articles.length : 0;

  // River model: find or create story — Step 2 of processing contract
  const riverCutoff   = new Date(Date.now() - RIVER_WINDOW_MS).toISOString();
  const existingStory = await findExistingStory(supabase, cluster, riverCutoff);

  let story_id;

  if (existingStory) {
    const existingPoints  = Array.isArray(existingStory.key_points) ? existingStory.key_points : [];
    const mergedKeyPoints = [...new Set([...existingPoints, ...narrative.key_points])].slice(0, 10);

    const { error: updateErr } = await supabase
      .from("stories")
      .update({
        primary_entities:          cluster.primary_entities,
        headline:                  narrative.headline,
        summary:                   narrative.summary,
        key_points:                mergedKeyPoints,
        confidence_score:          narrative.confidence_score,
        story_score,
        consistency_score,
        source_count,
        primary_geos:              storyPrimaryGeos,
        geo_scores:                storyGeoScores,
        global_significance_score: globalSignificanceScore,
        updated_at:                now,
      })
      .eq("id", existingStory.id);

    if (updateErr) throw new Error(`story update: ${updateErr.message}`);

    story_id = existingStory.id;
    context.log(JSON.stringify({ event: "story_merged", cluster_id, story_id, story_score, disposition, global_significance_score: globalSignificanceScore }));
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from("stories")
      .insert({
        cluster_id,
        category_id:               cluster.category_id,
        primary_entities:          cluster.primary_entities,
        headline:                  narrative.headline,
        summary:                   narrative.summary,
        key_points:                narrative.key_points,
        confidence_score:          narrative.confidence_score,
        story_score,
        consistency_score,
        source_count,
        primary_geos:              storyPrimaryGeos,
        geo_scores:                storyGeoScores,
        global_significance_score: globalSignificanceScore,
        is_verified:               false,
        published_at:              now,
        updated_at:                now,
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(`story insert: ${insertErr.message}`);

    story_id = inserted.id;
    context.log(JSON.stringify({ event: "story_written", cluster_id, story_id, story_score, disposition, global_significance_score: globalSignificanceScore }));
  }

  // ── Step 3: upsert story_audiences for every configured audience ──────────
  // Must succeed before PROCESSED is written — this is the commit point boundary.
  const projectionStory = {
    global_significance_score: globalSignificanceScore,
    primary_geos: storyPrimaryGeos,
  };
  const projectionExtras = { indian_article_fraction: indianArticleFraction };

  for (const audience of AUDIENCES) {
    const projection = computeAudienceProjection(projectionStory, cluster, audience, projectionExtras);

    const { error: audErr } = await supabase
      .from("story_audiences")
      .upsert(
        {
          story_id,
          audience_geo:    audience,
          relevance_score: projection.relevance_score,
          rank_bucket:     projection.rank_bucket,
          rank_priority:   projection.rank_priority,
          reason:          projection.reason,
          updated_at:      now,
        },
        { onConflict: "story_id,audience_geo" },
      );

    if (audErr) throw new Error(`story_audiences upsert (${audience}): ${audErr.message}`);

    context.log(JSON.stringify({
      event:           "story_audience_projected",
      story_id,
      audience_geo:    audience,
      rank_bucket:     projection.rank_bucket,
      rank_priority:   projection.rank_priority,
      relevance_score: projection.relevance_score,
      reason:          projection.reason,
    }));
  }

  // ── Step 4: Mark cluster PROCESSED — commit point (must be last DB write) ─
  // autoComplete: true (host.json) — returning normally completes the SB message.
  await supabase
    .from("clusters")
    .update({ status: "PROCESSED", updated_at: now })
    .eq("id", cluster_id);
}

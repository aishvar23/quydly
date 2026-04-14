// Phase 5 — Gold Set Pipeline: Synthesizer
// Two-pass Claude API: fact extraction per article → narrative generation.
// River model: find existing story by cluster_id first, then by entity overlap.
// Max 10 concurrent cluster syntheses; 2× retry on transient errors before FAILED.
// Quality-gate failures (low confidence / low key_points) mark PROCESSED, not FAILED.
//
// Two-phase execution:
//   Phase A (concurrent) — Claude API calls only; no DB writes.
//   Phase B (serial)     — quality gates + River lookup + DB writes.
// Phase B is serial to eliminate the River-model check-then-insert race
// that exists when two concurrent workers both observe "no existing story"
// and both attempt to insert for the same real-world event.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { computeStoryScore, storyDisposition } from '../utils/scoring.js';
import FLAGS from '../../config/flags.js';

const MODEL             = 'claude-sonnet-4-20250514';
const MAX_CONCURRENCY   = 10;
const MAX_RETRIES       = 2;
const CONTENT_TRUNCATE  = 500;   // chars of cleaned content passed to Claude per article
const RIVER_WINDOW_MS   = 24 * 60 * 60 * 1000;
const CLUSTER_LIMIT     = 100;   // fetch headroom; filtered down to 50 after JS checks
const STORY_WRITE_LIMIT = 50;

// ── Supabase / Anthropic factories ──────────────────────────────────────────

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  );
}

function buildAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Concurrency limiter ──────────────────────────────────────────────────────
// Runs `tasks` array with at most `limit` workers in flight simultaneously.
// JS is single-threaded; the `index++` increment is safe across workers.

async function runConcurrent(limit, tasks) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= tasks.length) break;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return results;
}

// ── Claude pass 1: fact extraction ──────────────────────────────────────────

/**
 * Extract structured facts from all articles in one cluster.
 * @param {Anthropic} ai
 * @param {object[]} articles — [{ title, description, content, domain }]
 * @returns {Promise<Array<{ fact: string, type: string, source_count: number }>>}
 */
async function extractFacts(ai, articles) {
  const articleBlocks = articles
    .map((a, i) => {
      const body = [
        a.title,
        a.description,
        a.content ? a.content.slice(0, CONTENT_TRUNCATE) : null,
      ]
        .filter(Boolean)
        .join(' ');
      return `[Article ${i + 1} — ${a.domain}]\n${body}`;
    })
    .join('\n\n');

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
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let facts;
  try {
    facts = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 1 invalid JSON: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(facts)) {
    throw new Error('Pass 1: expected a JSON array of facts');
  }
  return facts;
}

// ── Claude pass 2: narrative generation ─────────────────────────────────────

/**
 * Generate a synthesised news narrative from extracted facts.
 * @param {Anthropic} ai
 * @param {object} cluster — { primary_entities, category_id, article_ids }
 * @param {object[]} facts — from Pass 1
 * @returns {Promise<{ headline: string, summary: string, key_points: string[], confidence_score: number }>}
 */
async function generateNarrative(ai, cluster, facts) {
  const factsText = facts
    .map(f => `- [${f.type}] ${f.fact}  (sources: ${f.source_count})`)
    .join('\n');

  const prompt = `You are a news editor synthesising a story for a daily news quiz.

Topic entities: ${cluster.primary_entities.join(', ')}
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
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].text.trim();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`Pass 2 invalid JSON: ${raw.slice(0, 200)}`);
  }

  if (
    typeof result.headline !== 'string' ||
    typeof result.summary  !== 'string' ||
    !Array.isArray(result.key_points)   ||
    typeof result.confidence_score !== 'number'
  ) {
    throw new Error(
      `Pass 2 missing required fields; got keys: ${Object.keys(result).join(', ')}`,
    );
  }

  return result;
}

// ── Phase A: Claude passes — concurrent, no DB writes ───────────────────────

/**
 * Run Pass 1 + Pass 2 for one cluster.  No DB side-effects.
 * Returns { facts, narrative } or throws on API / parse error.
 * @param {Anthropic} ai
 * @param {object} cluster
 * @param {object[]} articles
 */
async function runClaudePasses(ai, cluster, articles) {
  const facts     = await extractFacts(ai, articles);
  const narrative = await generateNarrative(ai, cluster, facts);
  return { facts, narrative };
}

// ── Cluster status helper ────────────────────────────────────────────────────

async function setClusterStatus(supabase, clusterId, status) {
  const { error } = await supabase
    .from('clusters')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', clusterId);

  if (error) {
    console.error(JSON.stringify({
      event:      'cluster_status_update_error',
      cluster_id: clusterId,
      status,
      error:      error.message,
    }));
  }
}

// ── River model: find existing story to merge ────────────────────────────────

/**
 * Find an existing story to merge with (River model).
 * Strategy:
 *   1. Match by cluster_id within the last 24h.
 *   2. If none, match by same category_id + ≥2 overlapping primary_entities within 24h.
 *
 * @param {object} supabase
 * @param {object} cluster — { id, category_id, primary_entities }
 * @param {string} riverCutoff — ISO timestamp
 * @returns {Promise<object|null>} — existing story row or null
 */
async function findExistingStory(supabase, cluster, riverCutoff) {
  // Strategy 1: same cluster_id
  const { data: byCluster, error: e1 } = await supabase
    .from('stories')
    .select('id, primary_entities, key_points, updated_at')
    .eq('cluster_id', cluster.id)
    .gte('updated_at', riverCutoff)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e1) {
    console.error(JSON.stringify({ event: 'river_lookup_error', cluster_id: cluster.id, error: e1.message }));
  }
  if (byCluster) return byCluster;

  // Strategy 2: entity overlap — fetch recent stories in same category, pick best overlap
  const { data: candidates, error: e2 } = await supabase
    .from('stories')
    .select('id, primary_entities, key_points, updated_at')
    .eq('category_id', cluster.category_id)
    .gte('updated_at', riverCutoff)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (e2) {
    console.error(JSON.stringify({ event: 'river_lookup_error', cluster_id: cluster.id, error: e2.message }));
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  let best        = null;
  let bestOverlap = 0;

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

// ── Phase B: quality gates + DB write — called serially ─────────────────────

/**
 * Apply quality gates, score, and upsert story.
 * Called in a serial loop after all Claude work is done — no concurrent DB writes.
 *
 * @param {object} supabase
 * @param {object} cluster
 * @param {object[]} facts — from Pass 1
 * @param {object}  narrative — from Pass 2
 * @returns {Promise<{ written: boolean, disposition: string|null, reason: string|null }>}
 */
async function writeStoryResult(supabase, cluster, facts, narrative) {
  // Quality gate: confidence
  if (narrative.confidence_score < 6) {
    console.log(JSON.stringify({
      event:      'LOW_CONFIDENCE',
      cluster_id: cluster.id,
      confidence: narrative.confidence_score,
    }));
    await setClusterStatus(supabase, cluster.id, 'PROCESSED');
    return { written: false, disposition: null, reason: 'LOW_CONFIDENCE' };
  }

  // Quality gate: key_points completeness
  if (narrative.key_points.length < 3) {
    console.log(JSON.stringify({
      event:      'LOW_KEY_POINTS',
      cluster_id: cluster.id,
      count:      narrative.key_points.length,
    }));
    await setClusterStatus(supabase, cluster.id, 'PROCESSED');
    return { written: false, disposition: null, reason: 'LOW_KEY_POINTS' };
  }

  // Scoring
  const synthesisResult = { ...narrative, facts };
  const { story_score, consistency_score, source_count } =
    computeStoryScore(cluster, synthesisResult);
  const disposition = storyDisposition(story_score);

  if (disposition === 'reject') {
    console.log(JSON.stringify({
      event:       'LOW_STORY_SCORE',
      cluster_id:  cluster.id,
      story_score,
      disposition,
    }));
    await setClusterStatus(supabase, cluster.id, 'PROCESSED');
    return { written: false, disposition, reason: 'LOW_STORY_SCORE' };
  }

  // River model
  const riverCutoff   = new Date(Date.now() - RIVER_WINDOW_MS).toISOString();
  const existingStory = await findExistingStory(supabase, cluster, riverCutoff);
  const now           = new Date().toISOString();

  if (existingStory) {
    // Merge key_points (deduplicate), refresh summary + scores
    const existingPoints  = Array.isArray(existingStory.key_points) ? existingStory.key_points : [];
    const mergedKeyPoints = [...new Set([...existingPoints, ...narrative.key_points])].slice(0, 10);

    const { error: updateErr } = await supabase
      .from('stories')
      .update({
        primary_entities:  cluster.primary_entities,
        headline:          narrative.headline,
        summary:           narrative.summary,
        key_points:        mergedKeyPoints,
        confidence_score:  narrative.confidence_score,
        story_score,
        consistency_score,
        source_count,
        updated_at:        now,
      })
      .eq('id', existingStory.id);

    if (updateErr) throw new Error(`story update: ${updateErr.message}`);

    console.log(JSON.stringify({
      event:       'story_merged',
      cluster_id:  cluster.id,
      story_id:    existingStory.id,
      story_score,
      disposition,
    }));
  } else {
    const { error: insertErr } = await supabase
      .from('stories')
      .insert({
        cluster_id:        cluster.id,
        category_id:       cluster.category_id,
        primary_entities:  cluster.primary_entities,
        headline:          narrative.headline,
        summary:           narrative.summary,
        key_points:        narrative.key_points,
        confidence_score:  narrative.confidence_score,
        story_score,
        consistency_score,
        source_count,
        is_verified:       false,
        published_at:      now,
        updated_at:        now,
      });

    if (insertErr) throw new Error(`story insert: ${insertErr.message}`);

    console.log(JSON.stringify({
      event:       'story_written',
      cluster_id:  cluster.id,
      story_score,
      disposition,
    }));
  }

  await setClusterStatus(supabase, cluster.id, 'PROCESSED');
  return { written: true, disposition, reason: null };
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Run one full synthesis pass.
 *
 * Steps:
 *   1. Fetch eligible PENDING clusters (cluster_score ≥ threshold, arrays ≥ 2), cap at 50.
 *   2. Mark all selected clusters PROCESSING.
 *   3. Batch-fetch all article data in one query.
 *      On failure: reset all claimed clusters to PENDING before throwing.
 *   4a. Phase A — concurrent Claude API calls (no DB writes).
 *   4b. Phase B — serial quality gates + River lookup + DB writes.
 *   5. Aggregate and return run summary.
 *
 * @returns {{
 *   clusters_fetched:    number,
 *   stories_written:     number,
 *   stories_rejected:    number,
 *   stories_low_conf:    number,
 *   stories_low_points:  number,
 *   clusters_failed:     number,
 *   disposition_publish: number,
 *   disposition_review:  number,
 * }}
 */
export async function runSynthesis() {
  const supabase = buildSupabase();
  const ai       = buildAnthropic();

  // ── 1. Fetch eligible PENDING clusters ────────────────────────────────────
  // Supabase JS client can't filter on array length; fetch with headroom and filter in JS.
  const { data: rawClusters, error: fetchErr } = await supabase
    .from('clusters')
    .select('id, category_id, primary_entities, article_ids, unique_domains, cluster_score')
    .eq('status', 'PENDING')
    .gte('cluster_score', FLAGS.scoring.cluster.eligible)
    .order('cluster_score', { ascending: false })
    .limit(CLUSTER_LIMIT);

  if (fetchErr) throw new Error(`[synthesizer] fetch clusters: ${fetchErr.message}`);

  const clusters = (rawClusters ?? [])
    .filter(
      c =>
        Array.isArray(c.article_ids)    && c.article_ids.length    >= 2 &&
        Array.isArray(c.unique_domains) && c.unique_domains.length >= 2,
    )
    .slice(0, STORY_WRITE_LIMIT);

  if (clusters.length === 0) {
    const empty = {
      clusters_fetched:    0,
      stories_written:     0,
      stories_rejected:    0,
      stories_low_conf:    0,
      stories_low_points:  0,
      clusters_failed:     0,
      disposition_publish: 0,
      disposition_review:  0,
    };
    console.log(JSON.stringify({ event: 'synthesis_no_eligible_clusters', ...empty }));
    return empty;
  }

  // ── 2. Immediately mark all selected clusters PROCESSING ──────────────────
  const clusterIds = clusters.map(c => c.id);
  const { error: markErr } = await supabase
    .from('clusters')
    .update({ status: 'PROCESSING', updated_at: new Date().toISOString() })
    .in('id', clusterIds);

  if (markErr) {
    // Non-fatal — log and continue; worst case is double-processing a cluster
    console.error(JSON.stringify({
      event: 'mark_processing_error',
      error: markErr.message,
    }));
  }

  // ── 3. Batch-fetch all article data in one query ──────────────────────────
  // On failure: reset claimed clusters to PENDING so the next run can retry.
  const allArticleIds = [...new Set(clusters.flatMap(c => c.article_ids))];

  const { data: allArticles, error: artErr } = await supabase
    .from('raw_articles')
    .select('id, title, description, content, domain')
    .in('id', allArticleIds);

  if (artErr) {
    // Reset claimed clusters so they are not stranded as PROCESSING
    await supabase
      .from('clusters')
      .update({ status: 'PENDING', updated_at: new Date().toISOString() })
      .in('id', clusterIds);

    throw new Error(`[synthesizer] fetch articles: ${artErr.message}`);
  }

  const articleMap = new Map((allArticles ?? []).map(a => [a.id, a]));

  // ── 4a. Phase A: concurrent Claude API calls (no DB writes) ───────────────
  const phaseAResults = await runConcurrent(MAX_CONCURRENCY, clusters.map(cluster => async () => {
    const articles = cluster.article_ids
      .map(id => articleMap.get(id))
      .filter(Boolean);

    if (articles.length === 0) {
      return { cluster, skipped: 'NO_ARTICLES' };
    }

    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { facts, narrative } = await runClaudePasses(ai, cluster, articles);
        return { cluster, facts, narrative };
      } catch (err) {
        lastErr = err;
        console.error(JSON.stringify({
          event:      'synthesis_attempt_failed',
          cluster_id: cluster.id,
          attempt,
          error:      err.message,
        }));
      }
    }

    return { cluster, error: lastErr };
  }));

  // ── 4b. Phase B: serial quality gates + River lookup + DB writes ──────────
  const writeResults = [];

  for (const item of phaseAResults) {
    const { cluster } = item;

    if (item.skipped === 'NO_ARTICLES') {
      console.warn(JSON.stringify({ event: 'synthesis_no_articles', cluster_id: cluster.id }));
      await setClusterStatus(supabase, cluster.id, 'PROCESSED');
      writeResults.push({ written: false, disposition: null, reason: 'NO_ARTICLES' });
      continue;
    }

    if (item.error) {
      await setClusterStatus(supabase, cluster.id, 'FAILED');
      console.error(JSON.stringify({
        event:             'synthesis_failed',
        cluster_id:        cluster.id,
        error:             item.error.message,
        article_ids:       cluster.article_ids,
        primary_entities:  cluster.primary_entities,
      }));
      writeResults.push({ written: false, disposition: null, reason: 'ERROR' });
      continue;
    }

    try {
      const result = await writeStoryResult(supabase, cluster, item.facts, item.narrative);
      writeResults.push(result);
    } catch (err) {
      await setClusterStatus(supabase, cluster.id, 'FAILED');
      console.error(JSON.stringify({
        event:             'synthesis_failed',
        cluster_id:        cluster.id,
        error:             err.message,
        article_ids:       cluster.article_ids,
        primary_entities:  cluster.primary_entities,
      }));
      writeResults.push({ written: false, disposition: null, reason: 'ERROR' });
    }
  }

  // ── 5. Aggregate summary ──────────────────────────────────────────────────
  let stories_written     = 0;
  let stories_rejected    = 0;
  let stories_low_conf    = 0;
  let stories_low_points  = 0;
  let clusters_failed     = 0;
  let disposition_publish = 0;
  let disposition_review  = 0;

  for (const r of writeResults) {
    if (r.written) {
      stories_written++;
      if (r.disposition === 'publish') disposition_publish++;
      if (r.disposition === 'review')  disposition_review++;
    } else {
      if (r.reason === 'LOW_STORY_SCORE') stories_rejected++;
      if (r.reason === 'LOW_CONFIDENCE')  stories_low_conf++;
      if (r.reason === 'LOW_KEY_POINTS')  stories_low_points++;
      if (r.reason === 'ERROR')           clusters_failed++;
    }
  }

  const summary = {
    clusters_fetched:    clusters.length,
    stories_written,
    stories_rejected,
    stories_low_conf,
    stories_low_points,
    clusters_failed,
    disposition_publish,
    disposition_review,
  };

  console.log(JSON.stringify({ event: 'synthesis_complete', ...summary }));
  return summary;
}

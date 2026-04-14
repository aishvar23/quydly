// Phase 3 — Scoring Utilities
// Computes cluster and story scores for the Gold Set pipeline.
// No external dependencies.

import FLAGS from "../../config/flags.js";

const { cluster: CLUSTER_T, story: STORY_T } = FLAGS.scoring;

/**
 * computeClusterScore — pre-LLM scoring gate.
 *
 * Formula:
 *   article_count_score = log(article_ids.length + 1)
 *   domain_score        = unique_domains.length
 *   entity_count_score  = primary_entities.length
 *   recency_score       = 1.0 (≤6h) | 0.7 (≤12h) | 0.4 (≤24h) | 0.1 (older)
 *
 *   cluster_score = (2 × article_count_score) + (3 × domain_score)
 *                 + (2 × entity_count_score) + (2 × recency_score)
 *
 * Thresholds (from FLAGS.scoring.cluster):
 *   ≥ eligible → send to LLM
 *   ≥ optional → conditional send
 *   < optional → discard
 *
 * @param {{ article_ids: any[], unique_domains: any[], primary_entities: any[], updated_at: string|Date }} cluster
 * @returns {number}
 */
export function computeClusterScore(cluster) {
  const articleCount = Array.isArray(cluster.article_ids) ? cluster.article_ids.length : 0;
  const domainCount  = Array.isArray(cluster.unique_domains) ? cluster.unique_domains.length : 0;
  const entityCount  = Array.isArray(cluster.primary_entities) ? cluster.primary_entities.length : 0;

  const articleCountScore = Math.log(articleCount + 1);
  const domainScore       = domainCount;
  const entityCountScore  = entityCount;
  const recencyScore      = _recencyScore(cluster.updated_at);

  return (
    2 * articleCountScore +
    3 * domainScore +
    2 * entityCountScore +
    2 * recencyScore
  );
}

/**
 * clusterDisposition — threshold gate for cluster eligibility.
 *
 * Thresholds are read from FLAGS.scoring.cluster.
 *
 * @param {number} score
 * @returns {'eligible'|'optional'|'discard'}
 */
export function clusterDisposition(score) {
  if (score >= CLUSTER_T.eligible) return 'eligible';
  if (score >= CLUSTER_T.optional) return 'optional';
  return 'discard';
}

/**
 * computeStoryScore — post-LLM composite score.
 *
 * Formula:
 *   source_count      = unique article_ids count
 *   consistency_score = facts corroborated by ≥2 sources / total facts
 *   entity_score      = clamp(primary_entities.length, 0 if <2, max 6 if >6)
 *   confidence_score  = synthesisResult.confidence_score (1–10, clamped)
 *
 *   story_score = (2 × source_count) + (4 × consistency_score × 10)
 *              + (1 × entity_score)  + (2 × confidence_score)
 *
 * Thresholds (from FLAGS.scoring.story):
 *   ≥ publish → publish candidate
 *   ≥ review  → flag for manual review
 *   < review  → reject
 *
 * @param {{ article_ids: any[], primary_entities: any[] }} cluster
 * @param {{ confidence_score: number, facts: Array<{ source_count: number }> }} synthesisResult
 * @returns {{ story_score: number, consistency_score: number, source_count: number }}
 */
export function computeStoryScore(cluster, synthesisResult) {
  // Use unique article IDs to prevent duplicate inflation
  const sourceCount = Array.isArray(cluster.article_ids)
    ? new Set(cluster.article_ids).size
    : 0;
  const entityCount = Array.isArray(cluster.primary_entities) ? cluster.primary_entities.length : 0;
  const facts       = Array.isArray(synthesisResult.facts) ? synthesisResult.facts : [];

  const consistencyScore = facts.length > 0
    ? facts.filter(f => f.source_count >= 2).length / facts.length
    : 0;

  // Entity score: 0 if < 2, clamped to max 6
  const entityScore = entityCount < 2 ? 0 : Math.min(entityCount, 6);

  // Guard confidence_score: default 0 if missing/invalid, clamp to 0–10
  const rawConfidence = synthesisResult.confidence_score;
  const confidence = (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence))
    ? Math.min(Math.max(rawConfidence, 0), 10)
    : 0;

  const storyScore =
    2 * sourceCount +
    4 * consistencyScore * 10 +
    1 * entityScore +
    2 * confidence;

  return {
    story_score:       storyScore,
    consistency_score: consistencyScore,
    source_count:      sourceCount,
  };
}

/**
 * storyDisposition — threshold gate for story write decision.
 *
 * Thresholds are read from FLAGS.scoring.story.
 *
 * @param {number} score
 * @returns {'publish'|'review'|'reject'}
 */
export function storyDisposition(score) {
  if (score >= STORY_T.publish) return 'publish';
  if (score >= STORY_T.review)  return 'review';
  return 'reject';
}

// ── internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns a recency multiplier based on how recently the cluster was updated.
 * Falls back to lowest score (0.1) on missing or invalid timestamps.
 * @param {string|Date|null|undefined} updatedAt
 * @returns {number}
 */
function _recencyScore(updatedAt) {
  if (!updatedAt) return 0.1;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return 0.1;
  const ageMs  = Date.now() - ts;
  const ageHrs = ageMs / (1000 * 60 * 60);
  if (ageHrs <= 6)  return 1.0;
  if (ageHrs <= 12) return 0.7;
  if (ageHrs <= 24) return 0.4;
  return 0.1;
}

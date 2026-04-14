// Phase 3 — Scoring Utilities
// Computes cluster and story scores for the Gold Set pipeline.
// No external dependencies.

/**
 * computeClusterScore — pre-LLM scoring gate.
 *
 * Formula:
 *   article_count_score  = log(article_ids.length + 1)
 *   domain_score         = unique_domains.length
 *   entity_density_score = primary_entities.length
 *   recency_score        = 1.0 (≤6h) | 0.7 (≤12h) | 0.4 (≤24h) | 0.1 (older)
 *
 *   cluster_score = (2 × article_count_score) + (3 × domain_score)
 *                 + (2 × entity_density_score) + (2 × recency_score)
 *
 * @param {{ article_ids: any[], unique_domains: any[], primary_entities: any[], updated_at: string|Date }} cluster
 * @returns {number}
 */
export function computeClusterScore(cluster) {
  const articleCount = Array.isArray(cluster.article_ids) ? cluster.article_ids.length : 0;
  const domainCount  = Array.isArray(cluster.unique_domains) ? cluster.unique_domains.length : 0;
  const entityCount  = Array.isArray(cluster.primary_entities) ? cluster.primary_entities.length : 0;

  const articleCountScore  = Math.log(articleCount + 1);
  const domainScore        = domainCount;
  const entityDensityScore = entityCount;
  const recencyScore       = _recencyScore(cluster.updated_at);

  return (
    2 * articleCountScore +
    3 * domainScore +
    2 * entityDensityScore +
    2 * recencyScore
  );
}

/**
 * clusterDisposition — threshold gate for cluster eligibility.
 *
 * ≥ 8  → 'eligible'
 * 5–8  → 'optional'
 * < 5  → 'discard'
 *
 * @param {number} score
 * @returns {'eligible'|'optional'|'discard'}
 */
export function clusterDisposition(score) {
  if (score >= 8) return 'eligible';
  if (score >= 5) return 'optional';
  return 'discard';
}

/**
 * computeStoryScore — post-LLM composite score.
 *
 * Formula:
 *   source_score      = cluster.article_ids.length
 *   consistency_score = facts corroborated by ≥2 sources / total facts
 *   entity_score      = clamp(primary_entities.length, 0 if <2, max 6 if >6)
 *   confidence_score  = synthesisResult.confidence_score  (1–10)
 *
 *   story_score = (2 × source_score) + (4 × consistency_score × 10)
 *              + (1 × entity_score)  + (2 × confidence_score)
 *
 * @param {{ article_ids: any[], primary_entities: any[] }} cluster
 * @param {{ confidence_score: number, facts: Array<{ source_count: number }> }} synthesisResult
 * @returns {{ story_score: number, consistency_score: number, source_count: number }}
 */
export function computeStoryScore(cluster, synthesisResult) {
  const sourceCount = Array.isArray(cluster.article_ids) ? cluster.article_ids.length : 0;
  const entityCount = Array.isArray(cluster.primary_entities) ? cluster.primary_entities.length : 0;
  const facts       = Array.isArray(synthesisResult.facts) ? synthesisResult.facts : [];

  const consistencyScore = facts.length > 0
    ? facts.filter(f => f.source_count >= 2).length / facts.length
    : 0;

  // Entity score: 0 if < 2, clamped to max 6
  const entityScore = entityCount < 2 ? 0 : Math.min(entityCount, 6);

  const storyScore =
    2 * sourceCount +
    4 * consistencyScore * 10 +
    1 * entityScore +
    2 * synthesisResult.confidence_score;

  return {
    story_score:       storyScore,
    consistency_score: consistencyScore,
    source_count:      sourceCount,
  };
}

/**
 * storyDisposition — threshold gate for story write decision.
 *
 * ≥ 12 → 'publish'  (publish candidate)
 * 8–12 → 'review'   (written, flagged for manual review)
 * < 8  → 'reject'   (not written)
 *
 * @param {number} score
 * @returns {'publish'|'review'|'reject'}
 */
export function storyDisposition(score) {
  if (score >= 12) return 'publish';
  if (score >= 8)  return 'review';
  return 'reject';
}

// ── internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns a recency multiplier based on how recently the cluster was updated.
 * @param {string|Date|null|undefined} updatedAt
 * @returns {number}
 */
function _recencyScore(updatedAt) {
  if (!updatedAt) return 0.1;
  const ageMs  = Date.now() - new Date(updatedAt).getTime();
  const ageHrs = ageMs / (1000 * 60 * 60);
  if (ageHrs <= 6)  return 1.0;
  if (ageHrs <= 12) return 0.7;
  if (ageHrs <= 24) return 0.4;
  return 0.1;
}

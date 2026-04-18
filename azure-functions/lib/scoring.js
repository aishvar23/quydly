import FLAGS from "./flags.js";

const { cluster: CLUSTER_T, story: STORY_T } = FLAGS.scoring;

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

export function clusterDisposition(score) {
  if (score >= CLUSTER_T.eligible) return 'eligible';
  if (score >= CLUSTER_T.optional) return 'optional';
  return 'discard';
}

export function computeStoryScore(cluster, synthesisResult) {
  const sourceCount = Array.isArray(cluster.article_ids)
    ? new Set(cluster.article_ids).size
    : 0;
  const entityCount = Array.isArray(cluster.primary_entities) ? cluster.primary_entities.length : 0;
  const facts       = Array.isArray(synthesisResult.facts) ? synthesisResult.facts : [];

  const consistencyScore = facts.length > 0
    ? facts.filter(f => f.source_count >= 2).length / facts.length
    : 0;

  const entityScore = entityCount < 2 ? 0 : Math.min(entityCount, 6);

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

export function storyDisposition(score) {
  if (score >= STORY_T.publish) return 'publish';
  if (score >= STORY_T.review)  return 'review';
  return 'reject';
}

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

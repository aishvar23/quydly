// Phase 4 — Gold Set Pipeline: Clusterer
// River model: appends to existing PENDING clusters or creates new in-memory candidates.
// Persists only clusters meeting minimum quality: article_count >= 2, unique_domains >= 2.
// Computes cluster_score + last_scored_at on every persisted write.

import { createClient } from '@supabase/supabase-js';
import { extractEntities, hasHighSignalEntity } from '../utils/nlp.js';
import { computeClusterScore } from '../utils/scoring.js';
import FLAGS from '../../config/flags.js';

const MIN_ARTICLE_COUNT   = 2;
const MIN_DOMAIN_COUNT    = 2;
const MAX_CLUSTER_ENTITIES = 10;

function buildSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

/**
 * Merge two entity arrays deterministically.
 * Deduplicates, sorts by word count desc then char length desc, caps at MAX_CLUSTER_ENTITIES.
 * Both arrays must already be normalised (as returned by extractEntities).
 *
 * @param {string[]} existing
 * @param {string[]} incoming
 * @returns {string[]}
 */
function mergeEntities(existing, incoming) {
  const merged = [...new Set([...existing, ...incoming])];
  merged.sort((a, b) => {
    const wa = a.split(' ').length;
    const wb = b.split(' ').length;
    if (wa !== wb) return wb - wa;
    return b.length - a.length;
  });
  return merged.slice(0, MAX_CLUSTER_ENTITIES);
}

/**
 * Find the best matching cluster for a set of article entities.
 *
 * Match criteria (all must hold):
 *   - same category_id
 *   - ≥ 2 shared entities
 *   - at least 1 shared entity is high-signal (hasHighSignalEntity)
 *
 * "Best" = highest shared entity count.
 *
 * @param {string[]} articleEntities — normalised entities from the article
 * @param {string}   categoryId
 * @param {object[]} candidates     — working set (DB rows + in-memory candidates)
 * @returns {object|null}           — matched cluster object or null
 */
function findBestMatch(articleEntities, categoryId, candidates) {
  let best      = null;
  let bestCount = 0;

  for (const cluster of candidates) {
    if (cluster.category_id !== categoryId) continue;

    const shared = articleEntities.filter(e => cluster.primary_entities.includes(e));
    if (shared.length >= 2 && hasHighSignalEntity(shared) && shared.length > bestCount) {
      best      = cluster;
      bestCount = shared.length;
    }
  }

  return best;
}

/**
 * Run one clustering pass.
 *
 * Steps:
 *   1. Fetch DONE raw_articles published in the last 24h.
 *   2. Fetch PENDING clusters updated within the last 24–36h (River model).
 *   3. For each article (not already in a cluster):
 *        - Extract entities; skip if no high-signal entity.
 *        - Find best matching cluster from working set.
 *        - If matched: append article_id, merge domains + entities, mark dirty.
 *        - If not matched: push new in-memory candidate.
 *   4. Persist writes only for clusters meeting minimum quality
 *      (article_count >= 2 AND unique_domains >= 2).
 *   5. Compute cluster_score + last_scored_at on every persisted write.
 *
 * @returns {{
 *   articles_processed:          number,
 *   articles_skipped_no_signal:  number,
 *   articles_skipped_no_match:   number,
 *   clusters_updated:            number,
 *   clusters_created:            number,
 *   clusters_below_quality:      number,
 *   clusters_persist_failed:     number,
 *   clusters_eligible:           number,
 * }}
 */
export async function runClustering() {
  const supabase = buildSupabase();
  const now      = new Date().toISOString();

  // ── 1. Fetch recent DONE articles ───────────────────────────────────────────
  const articleSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: articles, error: artError } = await supabase
    .from('raw_articles')
    .select('id, title, description, domain, category_id, authority_score, published_at')
    .eq('status', 'DONE')
    .gte('published_at', articleSince)
    .order('authority_score', { ascending: false })
    .order('published_at',    { ascending: false });

  if (artError) throw new Error(`[clusterer] fetch articles: ${artError.message}`);

  if (!articles || articles.length === 0) {
    const empty = {
      articles_processed:         0,
      articles_skipped_no_signal: 0,
      articles_skipped_no_match:  0,
      clusters_updated:           0,
      clusters_created:           0,
      clusters_eligible:          0,
    };
    console.log(JSON.stringify({ event: 'clustering_no_articles', ...empty }));
    return empty;
  }

  // ── 2. Fetch candidate clusters (PENDING, last 24–36h) ──────────────────────
  const clusterSince = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

  const { data: existingRows, error: clustError } = await supabase
    .from('clusters')
    .select('id, category_id, primary_entities, article_ids, unique_domains, updated_at')
    .eq('status', 'PENDING')
    .gte('updated_at', clusterSince);

  if (clustError) throw new Error(`[clusterer] fetch clusters: ${clustError.message}`);

  // Working set: DB rows + in-memory candidates created this run.
  // _isNew  — not yet in DB; persisted on first quality pass
  // _dirty  — existing DB row modified; needs UPDATE
  const workingSet = (existingRows ?? []).map(c => ({
    id:               c.id,
    category_id:      c.category_id,
    primary_entities: Array.isArray(c.primary_entities) ? [...c.primary_entities] : [],
    article_ids:      Array.isArray(c.article_ids)      ? [...c.article_ids]      : [],
    unique_domains:   Array.isArray(c.unique_domains)   ? [...c.unique_domains]   : [],
    updated_at:       c.updated_at,
    cluster_score:    null,
    _isNew:           false,
    _dirty:           false,
  }));

  // Article IDs already assigned to a cluster — skip these without counting
  const alreadyClustered = new Set(workingSet.flatMap(c => c.article_ids));

  let articles_processed         = 0;
  let articles_skipped_no_signal = 0;
  let articles_skipped_no_match  = 0;

  // ── 3. Process each article ─────────────────────────────────────────────────
  for (const article of articles) {
    if (alreadyClustered.has(article.id)) continue;

    articles_processed++;

    const text     = [article.title, article.description].filter(Boolean).join(' ');
    const entities = extractEntities(text);

    if (!hasHighSignalEntity(entities)) {
      articles_skipped_no_signal++;
      continue;
    }

    const best = findBestMatch(entities, article.category_id, workingSet);

    if (best) {
      best.article_ids      = [...new Set([...best.article_ids, article.id])];
      best.unique_domains   = [...new Set([
        ...best.unique_domains,
        ...(article.domain ? [article.domain] : []),
      ])];
      best.primary_entities = mergeEntities(best.primary_entities, entities);
      best.updated_at       = now;
      best._dirty           = true;
      alreadyClustered.add(article.id);
    } else {
      // No existing match — create in-memory candidate.
      // Subsequent articles in this run can still match it.
      articles_skipped_no_match++;
      workingSet.push({
        id:               null,
        category_id:      article.category_id,
        primary_entities: entities,
        article_ids:      [article.id],
        unique_domains:   article.domain ? [article.domain] : [],
        updated_at:       now,
        cluster_score:    null,
        _isNew:           true,
        _dirty:           false,
      });
      alreadyClustered.add(article.id);
    }
  }

  // ── 4 & 5. Persist — score on every write ──────────────────────────────────
  // Quality gate (article_count >= 2, unique_domains >= 2) applies to NEW inserts only.
  // Existing dirty clusters are always written back regardless of current counts.
  let clusters_updated       = 0;
  let clusters_created       = 0;
  let clusters_below_quality = 0;
  let clusters_persist_failed = 0;

  for (const cluster of workingSet) {
    const score = computeClusterScore(cluster);

    const writePayload = {
      primary_entities: cluster.primary_entities,
      article_ids:      cluster.article_ids,
      unique_domains:   cluster.unique_domains,
      cluster_score:    score,
      last_scored_at:   now,
      updated_at:       now,
      status:           'PENDING',
    };

    if (cluster._isNew) {
      const meetsQuality =
        cluster.article_ids.length    >= MIN_ARTICLE_COUNT &&
        cluster.unique_domains.length >= MIN_DOMAIN_COUNT;

      if (!meetsQuality) {
        clusters_below_quality++;
        continue;
      }

      const { error } = await supabase
        .from('clusters')
        .insert({ ...writePayload, category_id: cluster.category_id });

      if (error) {
        clusters_persist_failed++;
        console.error(JSON.stringify({
          event:       'cluster_insert_error',
          category_id: cluster.category_id,
          entities:    cluster.primary_entities.slice(0, 3),
          error:       error.message,
        }));
      } else {
        clusters_created++;
        cluster.cluster_score = score;
      }
    } else if (cluster._dirty) {
      const { error } = await supabase
        .from('clusters')
        .update(writePayload)
        .eq('id', cluster.id);

      if (error) {
        clusters_persist_failed++;
        console.error(JSON.stringify({
          event:      'cluster_update_error',
          cluster_id: cluster.id,
          error:      error.message,
        }));
      } else {
        clusters_updated++;
        cluster.cluster_score = score;
      }
    }
  }

  // ── 6. Count eligible clusters ──────────────────────────────────────────────
  const clusters_eligible = workingSet.filter(c =>
    (c.cluster_score ?? 0) >= FLAGS.scoring.cluster.eligible &&
    c.article_ids.length   >= MIN_ARTICLE_COUNT &&
    c.unique_domains.length >= MIN_DOMAIN_COUNT
  ).length;

  const summary = {
    articles_processed,
    articles_skipped_no_signal,
    articles_skipped_no_match,
    clusters_updated,
    clusters_created,
    clusters_below_quality,
    clusters_persist_failed,
    clusters_eligible,
  };

  console.log(JSON.stringify({ event: 'clustering_complete', ...summary }));
  return summary;
}

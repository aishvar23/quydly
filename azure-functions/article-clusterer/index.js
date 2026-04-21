// Azure Timer Function: article-clusterer
// Trigger: every 2 hours — "0 0 */2 * * *"
//
// Clusters all unclustered DONE raw_articles into the clusters table.
// After each article is assigned to a cluster, sets clustered_at = NOW().
// Eligible clusters (score >= 20, article_ids >= 2, unique_domains >= 2)
// are sent to synthesize-queue — but only if not queued recently.
//
// Key design decisions (from design doc section 5.3):
//   - Strictly `WHERE clustered_at IS NULL AND status = 'DONE'` — no time window reopening.
//   - UPDATE clusters SET synthesis_queued_at BEFORE sending to SB queue.
//   - Duplicate SB messages are safe: story-synthesizer is idempotent on cluster_id.

import { getSupabase, getSbSender } from "../lib/clients.js";
import { extractEntities, hasHighSignalEntity } from "../lib/nlp.js";
import { computeClusterScore } from "../lib/scoring.js";
import { computePrimaryGeos, computeClusterGeoScores } from "../lib/geo.js";
import FLAGS from "../lib/flags.js";

const MIN_ARTICLE_COUNT    = 2;
const MIN_DOMAIN_COUNT     = 2;
const MAX_CLUSTER_ENTITIES = 10;
const SYNTHESIS_COOLDOWN_H = 4;       // re-enqueue only if synthesis_queued_at > 4h ago
const ELIGIBLE_SCORE       = FLAGS.scoring.cluster.eligible;

// ── Entity helpers (identical to backend/engine/clusterer.js) ─────────────────

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

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function articleClusterer(context, timer) {
  if (timer.isPastDue) {
    context.log("Timer is past due — running now.");
  }

  const supabase = getSupabase();
  const now      = new Date().toISOString();

  // ── 1. Fetch unclustered DONE articles (Change 1 from design doc) ─────────
  // Strict filter: clustered_at IS NULL AND status = 'DONE'.
  // No time-window reopening — an article processed here is never re-selected.
  const { data: articles, error: artError } = await supabase
    .from("raw_articles")
    .select("id, title, description, domain, category_id, authority_score, published_at, mentioned_geos, source_country, geo_scores")
    .eq("status", "DONE")
    .is("clustered_at", null)
    .order("authority_score", { ascending: false })
    .order("published_at",    { ascending: false });

  if (artError) throw new Error(`[article-clusterer] fetch articles: ${artError.message}`);

  if (!articles || articles.length === 0) {
    context.log(JSON.stringify({ event: "clustering_no_articles" }));
    return;
  }

  // ── 2. Fetch candidate PENDING clusters (last 36h River window) ──────────
  const clusterSince = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

  const { data: existingRows, error: clustError } = await supabase
    .from("clusters")
    .select("id, category_id, primary_entities, article_ids, unique_domains, cluster_score, updated_at, synthesis_queued_at")
    .eq("status", "PENDING")
    .gte("updated_at", clusterSince);

  if (clustError) throw new Error(`[article-clusterer] fetch clusters: ${clustError.message}`);

  // Working set: DB rows + in-memory candidates created this run.
  const workingSet = (existingRows ?? []).map(c => ({
    id:                   c.id,
    category_id:          c.category_id,
    primary_entities:     Array.isArray(c.primary_entities) ? [...c.primary_entities] : [],
    article_ids:          Array.isArray(c.article_ids)      ? [...c.article_ids]      : [],
    unique_domains:       Array.isArray(c.unique_domains)   ? [...c.unique_domains]   : [],
    updated_at:           c.updated_at,
    cluster_score:        typeof c.cluster_score === 'number' ? c.cluster_score : null,
    synthesis_queued_at:  c.synthesis_queued_at ?? null,
    _isNew:               false,
    _dirty:               false,
    _newArticleIds:       [],   // articles added this run — mark their clustered_at after persist
    _memberGeos:          [],   // { mentioned_geos, source_country, geo_scores } per member article
  }));

  const alreadyClustered = new Set(workingSet.flatMap(c => c.article_ids));

  // ── 2b. Batch-load member geo data for existing PENDING clusters ──────────
  // Needed so primary_geos / geo_scores / source_countries can be recomputed
  // from the full member set (not just articles added this run). Chunked
  // SELECTs (100 ids/chunk) unioned into a single geoById map — keeps PostgREST
  // URL length safe when PENDING clusters accumulate many members.
  const allMemberIds = [...new Set(workingSet.flatMap(c => c.article_ids))];
  if (allMemberIds.length > 0) {
    const CHUNK_SIZE = 100;
    const geoById = new Map();

    for (let i = 0; i < allMemberIds.length; i += CHUNK_SIZE) {
      const chunk = allMemberIds.slice(i, i + CHUNK_SIZE);
      const { data: memberRows, error: memErr } = await supabase
        .from("raw_articles")
        .select("id, mentioned_geos, source_country, geo_scores")
        .in("id", chunk);

      if (memErr) throw new Error(`[article-clusterer] fetch member geos: ${memErr.message}`);

      for (const r of memberRows ?? []) {
        geoById.set(r.id, {
          mentioned_geos: Array.isArray(r.mentioned_geos) ? r.mentioned_geos : [],
          source_country: r.source_country ?? null,
          geo_scores:     r.geo_scores ?? {},
        });
      }
    }

    for (const c of workingSet) {
      for (const id of c.article_ids) {
        const g = geoById.get(id);
        if (g) c._memberGeos.push(g);
      }
    }
  }

  let articles_processed         = 0;
  let articles_skipped_no_signal = 0;
  let articles_skipped_no_match  = 0;

  // ── 3. Process each article ───────────────────────────────────────────────
  for (const article of articles) {
    if (alreadyClustered.has(article.id)) continue;

    articles_processed++;
    const text     = [article.title, article.description].filter(Boolean).join(" ");
    const entities = extractEntities(text);

    if (!hasHighSignalEntity(entities)) {
      articles_skipped_no_signal++;
      // Still mark as clustered so we don't re-process on the next run.
      try {
        await supabase
          .from("raw_articles")
          .update({ clustered_at: now })
          .eq("id", article.id);
      } catch (err) {
        context.log.error(JSON.stringify({ event: "clustered_at_update_error", id: article.id, error: err.message }));
      }
      continue;
    }

    const best = findBestMatch(entities, article.category_id, workingSet);

    const articleGeo = {
      mentioned_geos: Array.isArray(article.mentioned_geos) ? article.mentioned_geos : [],
      source_country: article.source_country ?? null,
      geo_scores:     article.geo_scores ?? {},
    };

    if (best) {
      best.article_ids    = [...new Set([...best.article_ids, article.id])];
      best.unique_domains = [...new Set([...best.unique_domains, ...(article.domain ? [article.domain] : [])])];
      best.primary_entities = mergeEntities(best.primary_entities, entities);
      best.updated_at     = now;
      best._dirty         = true;
      best._newArticleIds.push(article.id);
      best._memberGeos.push(articleGeo);
      alreadyClustered.add(article.id);
    } else {
      articles_skipped_no_match++;
      workingSet.push({
        id:                  null,
        category_id:         article.category_id,
        primary_entities:    entities,
        article_ids:         [article.id],
        unique_domains:      article.domain ? [article.domain] : [],
        updated_at:          now,
        cluster_score:       null,
        synthesis_queued_at: null,
        _isNew:              true,
        _dirty:              false,
        _newArticleIds:      [article.id],
        _memberGeos:         [articleGeo],
      });
      alreadyClustered.add(article.id);
    }
  }

  // ── 4 & 5. Persist clusters + set clustered_at on processed articles ──────
  let clusters_updated        = 0;
  let clusters_created        = 0;
  let clusters_below_quality  = 0;
  let clusters_persist_failed = 0;
  let clusters_eligible       = 0;

  const synthesizeCooldownCutoff = new Date(Date.now() - SYNTHESIS_COOLDOWN_H * 60 * 60 * 1000).toISOString();

  for (const cluster of workingSet) {
    const score = computeClusterScore(cluster);

    // Geo aggregates — computed from the full member set (existing members
    // loaded at start, plus any added this run). Helpers handle empty/missing
    // fields as zero so pre-Phase-5 articles don't crash the pipeline.
    const source_countries = [
      ...new Set(cluster._memberGeos.map(g => g.source_country).filter(Boolean)),
    ].sort();
    const primary_geos = computePrimaryGeos(cluster._memberGeos);
    const geo_scores   = computeClusterGeoScores(cluster._memberGeos);

    const writePayload = {
      primary_entities: cluster.primary_entities,
      article_ids:      cluster.article_ids,
      unique_domains:   cluster.unique_domains,
      cluster_score:    score,
      last_scored_at:   now,
      updated_at:       now,
      status:           "PENDING",
      primary_geos,
      geo_scores,
      source_countries,
    };

    let persisted   = false;
    let persistedId = cluster.id;

    if (cluster._isNew) {
      const meetsQuality =
        cluster.article_ids.length    >= MIN_ARTICLE_COUNT &&
        cluster.unique_domains.length >= MIN_DOMAIN_COUNT;

      if (!meetsQuality) {
        clusters_below_quality++;
        // Mark articles as clustered so they aren't re-attempted next run
        await markArticlesClustered(supabase, cluster._newArticleIds, now, context);
        continue;
      }

      const { data: inserted, error } = await supabase
        .from("clusters")
        .insert({ ...writePayload, category_id: cluster.category_id })
        .select("id")
        .single();

      if (error) {
        clusters_persist_failed++;
        context.log.error(JSON.stringify({
          event:    "cluster_insert_error",
          category: cluster.category_id,
          error:    error.message,
        }));
      } else {
        clusters_created++;
        cluster.cluster_score = score;
        cluster.id            = inserted.id;
        persistedId           = inserted.id;
        persisted             = true;
      }

    } else if (cluster._dirty) {
      const { error } = await supabase
        .from("clusters")
        .update(writePayload)
        .eq("id", cluster.id);

      if (error) {
        clusters_persist_failed++;
        context.log.error(JSON.stringify({
          event:      "cluster_update_error",
          cluster_id: cluster.id,
          error:      error.message,
        }));
      } else {
        clusters_updated++;
        cluster.cluster_score = score;
        persisted             = true;
      }
    }

    // ── 4b. Mark processed articles as clustered_at ─────────────────────────
    if (cluster._newArticleIds.length > 0) {
      await markArticlesClustered(supabase, cluster._newArticleIds, now, context);
    }

    if (persisted && persistedId !== null) {
      context.log(JSON.stringify({
        event:           "cluster_geo_aggregated",
        cluster_id:      persistedId,
        primary_geos,
        source_countries,
        member_count:    cluster.article_ids.length,
      }));
    }

    // ── 5. Synthesize-queue: enqueue eligible clusters ────────────────────────
    // 6.5: guard — skip if recently queued (within SYNTHESIS_COOLDOWN_H hours)
    // 6.6: write synthesis_queued_at to DB BEFORE sending to SB queue
    if (
      persisted &&
      persistedId !== null &&
      score >= ELIGIBLE_SCORE &&
      cluster.article_ids.length    >= MIN_ARTICLE_COUNT &&
      cluster.unique_domains.length >= MIN_DOMAIN_COUNT
    ) {
      clusters_eligible++;

      const recentlyQueued =
        cluster.synthesis_queued_at !== null &&
        cluster.synthesis_queued_at > synthesizeCooldownCutoff;

      if (!recentlyQueued) {
        // Step a: write synthesis_queued_at BEFORE queue send
        const { error: sqErr } = await supabase
          .from("clusters")
          .update({ synthesis_queued_at: now })
          .eq("id", persistedId);

        if (sqErr) {
          context.log.error(JSON.stringify({
            event:      "synthesis_queued_at_error",
            cluster_id: persistedId,
            error:      sqErr.message,
          }));
          // If DB write fails, skip the queue send — next run will retry
          continue;
        }

        // Step b: send to synthesize-queue
        const sender = getSbSender("synthesize-queue");
        try {
          await sender.sendMessages({
            body:      { cluster_id: persistedId, category_id: cluster.category_id },
            messageId: String(persistedId),
          });
          context.log(JSON.stringify({ event: "cluster_enqueued", cluster_id: persistedId, score }));
        } catch (sbErr) {
          context.log.error(JSON.stringify({
            event:      "synthesize_enqueue_error",
            cluster_id: persistedId,
            error:      sbErr.message,
          }));
          // synthesis_queued_at is set but message wasn't sent.
          // Next run: synthesis_queued_at < NOW()-4h → re-enqueue. Acceptable.
        } finally {
          await sender.close();
        }
      }
    }
  }

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

  context.log(JSON.stringify({ event: "clustering_complete", ...summary }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function markArticlesClustered(supabase, articleIds, now, context) {
  if (!articleIds || articleIds.length === 0) return;

  const { error } = await supabase
    .from("raw_articles")
    .update({ clustered_at: now })
    .in("id", articleIds);

  if (error) {
    context.log.error(JSON.stringify({
      event:  "clustered_at_update_error",
      ids:    articleIds,
      error:  error.message,
    }));
  }
}

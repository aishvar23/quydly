#!/usr/bin/env node
// One-shot smoke for the P1-8 / P1-9 / P1-10 fields landed in PR #72.
//
// Usage:
//   node test/smoke-p1-final.js [cluster_id]
//
// Picks the highest-scoring PENDING cluster (or one passed by id) and invokes
// the synthesizer directly with a fakeContext — no Service Bus / func start
// runtime required. After completion, prints the new persisted columns so we
// can eyeball that the migration + synthesizer wiring lit up end-to-end.
//
// Idempotency: the synthesizer flips cluster.status PENDING → PROCESSING →
// PROCESSED, same as the queue-driven path. If a queue message lands while
// this is running, the second invocation will see status != PENDING and
// short-circuit cleanly.

import { supabase, fakeContext, cleanup } from "./helpers.js";
import storySynthesizer from "../story-synthesizer/index.js";

const argId = process.argv[2] ? Number(process.argv[2]) : null;

async function pickCluster() {
  if (argId) {
    const { data, error } = await supabase
      .from("clusters")
      .select("id, category_id, cluster_score, status, article_ids, unique_domains")
      .eq("id", argId)
      .single();
    if (error) throw new Error(`fetch cluster ${argId}: ${error.message}`);
    return data;
  }
  const { data, error } = await supabase
    .from("clusters")
    .select("id, category_id, cluster_score, status, article_ids, unique_domains")
    .eq("status", "PENDING")
    .gte("cluster_score", 20)
    .order("cluster_score", { ascending: false })
    .order("updated_at",    { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fetch eligible cluster: ${error.message}`);
  return data;
}

function previewSourceDocs(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.slice(0, 6).map((d) => ({
    id:       d.id,
    issuer:   d.issuer,
    quote:    d.quote_text ? `${d.quote_text.slice(0, 60)}…` : null,
    speaker:  d.quote_speaker ?? null,
  }));
}

try {
  const cluster = await pickCluster();
  if (!cluster) {
    console.error("No eligible PENDING cluster (score ≥ 20) — clusterer hasn't created any. Aborting.");
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify({
      event:           "smoke_start",
      cluster_id:      cluster.id,
      category_id:     cluster.category_id,
      cluster_score:   cluster.cluster_score,
      article_count:   cluster.article_ids?.length ?? 0,
      domain_count:    cluster.unique_domains?.length ?? 0,
      cluster_status:  cluster.status,
    }, null, 2));

    if (cluster.status !== "PENDING") {
      console.warn(`cluster ${cluster.id} status is '${cluster.status}', not PENDING — synthesizer will short-circuit. Pick a different cluster id or wait.`);
    }

    const ctx = fakeContext(`synth-smoke-${cluster.id}`);
    const t0  = Date.now();
    await storySynthesizer(ctx, { cluster_id: cluster.id, category_id: cluster.category_id });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nsynthesizer returned in ${elapsed}s\n`);

    // Pull the resulting story (most recent for this cluster_id)
    const { data: story, error: stErr } = await supabase
      .from("stories")
      .select(
        "id, cluster_id, headline, story_type, editorial_posture, hook_sentence, why_it_matters, " +
        "structured_numbers, timeline_events, primary_entities_enriched, " +
        "source_documents, source_diversity_score, source_diversity_label, " +
        "verification_status, factual_conflicts, source_count, story_score, updated_at",
      )
      .eq("cluster_id", cluster.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (stErr) throw new Error(`fetch story for cluster ${cluster.id}: ${stErr.message}`);

    if (!story) {
      console.error("\nNo story row found for cluster — likely a quality-gate reject. Check the synth log lines above for LOW_CONFIDENCE / LOW_KEY_POINTS / LOW_STORY_SCORE.");
      process.exitCode = 3;
    } else {
      const summary = {
        story_id:                story.id,
        cluster_id:              story.cluster_id,
        story_score:             story.story_score,
        source_count:            story.source_count,
        updated_at:              story.updated_at,
        headline:                story.headline,
        // PR #71 fields
        story_type:              story.story_type,
        editorial_posture:       story.editorial_posture,
        hook_sentence:           story.hook_sentence,
        why_it_matters:          story.why_it_matters,
        structured_numbers_keys: story.structured_numbers
          ? Object.fromEntries(Object.entries(story.structured_numbers).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]))
          : null,
        timeline_events_count:   Array.isArray(story.timeline_events) ? story.timeline_events.length : 0,
        entities_count:          Array.isArray(story.primary_entities_enriched) ? story.primary_entities_enriched.length : 0,
        entities_resolved:       Array.isArray(story.primary_entities_enriched)
          ? story.primary_entities_enriched.filter(e => e.wiki_resolved).length : 0,
        // PR #72 (P1-8/9/10) fields
        source_diversity_score:  story.source_diversity_score,
        source_diversity_label:  story.source_diversity_label,
        verification_status:     story.verification_status,
        factual_conflicts:       story.factual_conflicts,
        source_documents_count:  Array.isArray(story.source_documents) ? story.source_documents.length : 0,
        source_documents_preview: previewSourceDocs(story.source_documents),
      };
      console.log("STORY ROW SUMMARY:\n");
      console.log(JSON.stringify(summary, null, 2));

      // Green-light checks ─ explicit pass/fail rather than visual inspection.
      const checks = {
        "story row exists":                       Boolean(story.id),
        "verification_status set":                story.verification_status === "draft",
        "source_diversity_score numeric":         typeof story.source_diversity_score === "number"
                                                   && story.source_diversity_score >= 0
                                                   && story.source_diversity_score <= 1,
        "source_diversity_label set":             ["single","narrow","diverse"].includes(story.source_diversity_label),
        "factual_conflicts is array":             Array.isArray(story.factual_conflicts),
        "source_documents non-empty":             Array.isArray(story.source_documents) && story.source_documents.length > 0,
      };
      console.log("\nCHECKS:");
      let pass = true;
      for (const [name, ok] of Object.entries(checks)) {
        console.log(`  ${ok ? "✓" : "✗"} ${name}`);
        if (!ok) pass = false;
      }
      console.log(pass ? "\nGREEN — all P1-8/9/10 fields populated as expected.\n" : "\nFAIL — see ✗ above.\n");
      if (!pass) process.exitCode = 4;
    }
  }
} catch (err) {
  console.error("SMOKE FAILED:", err);
  process.exitCode = 1;
} finally {
  await cleanup();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}

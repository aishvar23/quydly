// One-time backfill: recompute audience projections for stories from the last
// 48 hours and upsert into story_audiences.
//
// Run from the azure-functions/ directory:
//   node scripts/backfill-story-audiences.js
//
// Idempotent — safe to re-run; every write uses ON CONFLICT DO UPDATE.

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: resolve(dirname(__filename), "../../.env") });

import { createClient } from "@supabase/supabase-js";
import { AUDIENCES, computeAudienceProjection } from "../lib/geo.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_SIZE = 50;
const WINDOW_HOURS = 48;

async function run() {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  console.log(`[backfill] fetching stories published after ${since}`);

  // Fetch stories + joined cluster data in one query
  const { data: stories, error: storiesErr } = await supabase
    .from("stories")
    .select(
      "id, global_significance_score, primary_geos, geo_scores, " +
      "clusters(id, primary_geos, geo_scores, source_countries, primary_entities)"
    )
    .gte("published_at", since)
    .order("published_at", { ascending: false });

  if (storiesErr) {
    console.error("[backfill] stories fetch failed:", storiesErr.message);
    process.exit(1);
  }

  console.log(`[backfill] ${stories.length} stories to process`);

  let upserted = 0;
  let skipped  = 0;

  for (let i = 0; i < stories.length; i += BATCH_SIZE) {
    const batch = stories.slice(i, i + BATCH_SIZE);

    for (const story of batch) {
      const cluster = story.clusters ?? {};
      const storyShape = {
        global_significance_score: story.global_significance_score ?? 0,
        primary_geos:              story.primary_geos ?? [],
      };

      for (const audience of AUDIENCES) {
        const projection = computeAudienceProjection(storyShape, cluster, audience);

        const { error: audErr } = await supabase
          .from("story_audiences")
          .upsert(
            {
              story_id:        story.id,
              audience_geo:    audience,
              relevance_score: projection.relevance_score,
              rank_bucket:     projection.rank_bucket,
              rank_priority:   projection.rank_priority,
              reason:          projection.reason,
              updated_at:      new Date().toISOString(),
            },
            { onConflict: "story_id,audience_geo" }
          );

        if (audErr) {
          console.error(
            `[backfill] upsert failed story_id=${story.id} audience=${audience}:`,
            audErr.message
          );
          skipped++;
        } else {
          upserted++;
        }
      }
    }

    console.log(`[backfill] processed ${Math.min(i + BATCH_SIZE, stories.length)} / ${stories.length}`);
  }

  console.log(`[backfill] done — ${upserted} upserted, ${skipped} skipped`);
}

run().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});

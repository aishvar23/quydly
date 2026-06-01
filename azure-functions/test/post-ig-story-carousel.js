#!/usr/bin/env node
// Render + (optionally) publish a real story's Instagram carousel.
//
// Builds the deterministic IG caption (platforms/instagram.js) + the 4-slide
// carousel for a given story id, uploads the slides to Supabase, and prints the
// caption. With --live it publishes the carousel to Instagram and reads the
// post back (permalink) to confirm — nothing is posted without --live.
//
// Usage:
//   node test/post-ig-story-carousel.js <storyId>           # render only (no post)
//   node test/post-ig-story-carousel.js <storyId> --live    # publish for real

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

import { createCardService } from "../lib/social/card-storage.js";
import { renderCarouselSlides } from "../lib/social/card-renderer.js";
import * as instagram from "../lib/social/platforms/instagram.js";
import * as ig from "../lib/social/instagram-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
Object.assign(process.env, settings.Values);

const storyId = process.argv[2];
const LIVE = process.argv.includes("--live");
if (!storyId) { console.error("Usage: node test/post-ig-story-carousel.js <storyId> [--live]"); process.exit(1); }

const log = Object.assign((...a) => console.log(...a), { warn: (...a) => console.warn("[WARN]", ...a), error: (...a) => console.error("[ERROR]", ...a) });

try {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: story, error } = await supabase
    .from("stories")
    .select("id, headline, summary, category_id, key_points")
    .eq("id", storyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!story) throw new Error(`story ${storyId} not found`);

  console.log(`\n=== Story ${story.id} [${story.category_id}] ===`);
  console.log(story.headline);

  // Caption (deterministic IG formatter).
  const caption = instagram.format(story, "global").text;
  console.log(`\n--- IG caption (${caption.length} chars) ---\n${caption}\n`);

  // Render slides locally for inspection.
  const local = await renderCarouselSlides(story);
  local.forEach((s) => writeFileSync(join("/tmp", `live-${s.index}-${s.slideType}.jpg`), s.buffer));
  console.log(`Rendered ${local.length} slides to /tmp/live-*.jpg`);

  // Upload to Supabase (public URLs).
  const svc = createCardService({ supabase, logger: log });
  const slides = await svc.getCarouselSlideUrls({ story });
  if (!slides) throw new Error("slide upload failed");
  console.log("\nUploaded slide URLs:");
  slides.forEach((s) => console.log(`  [${s.index}] ${s.slideType}: ${s.url}`));

  if (!LIVE) {
    console.log("\n(dry — no post). Re-run with --live to publish.\n");
    process.exit(0);
  }

  // LIVE publish.
  const creds = ig.credsFromEnv(process.env);
  console.log(`\nPublishing carousel to IG ${creds.igUserId} ...`);
  const result = await ig.publish({ post_text: caption }, { creds, slides, logger: log });
  console.log(`Published. media_id=${result.platformPostId}`);

  // Read back the published media to confirm (permalink + type).
  const back = await fetch(`https://graph.facebook.com/${creds.graphVersion}/${result.platformPostId}?fields=id,permalink,media_type,media_product_type,timestamp&access_token=${encodeURIComponent(creds.accessToken)}`);
  const meta = await back.json();
  console.log("\n=== Read-back ===");
  console.log(JSON.stringify(meta, null, 2));
  console.log(`\n✅ Live carousel posted. Verify: ${meta.permalink || "(open @quydlyenglish)"}\n`);
} catch (err) {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
}

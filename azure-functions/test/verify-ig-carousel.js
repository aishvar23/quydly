#!/usr/bin/env node
// Live verification for the Instagram carousel path (tracker L4) — posts NOTHING
// to Instagram by default. Exercises the two real integrations:
//   1. Render 4 JPEG slides + upload to Supabase Storage → ordered public URLs.
//   2. Confirm each URL is publicly fetchable AND is a JPEG (Instagram rejects
//      non-JPEG and non-public URLs — the two most common publish failures).
//   3. Assemble the full Graph API carousel request in DRY-RUN (no Meta call).
//
// Usage:
//   node test/verify-ig-carousel.js            # dry-run (safe, no IG post)
//   node test/verify-ig-carousel.js --live     # ACTUALLY publishes to Instagram
//
// --live requires INSTAGRAM_BUSINESS_ACCOUNT_ID + META_PAGE_ACCESS_TOKEN in env
// and publishes a real carousel — only run it after explicit confirmation.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

import { createCardService } from "../lib/social/card-storage.js";
import * as ig from "../lib/social/instagram-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
Object.assign(process.env, settings.Values);

const LIVE = process.argv.includes("--live");

const log = Object.assign((...a) => console.log(...a), {
  warn: (...a) => console.warn("[WARN]", ...a),
  error: (...a) => console.error("[ERROR]", ...a),
});

const STORY = {
  id: "verify-carousel",
  category_id: "finance",
  headline: "Carousel path verification — Quydly daily news quiz",
  summary: "This is a synthetic story used only to verify the Instagram carousel render and upload path. It posts nothing unless --live is passed.",
  key_points: [
    "Slide rendering produces four square JPEG cards",
    "Each slide is uploaded to Supabase Storage as a public URL",
    "The Graph API request is assembled child → carousel → publish",
  ],
};

try {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log(`\n=== Instagram carousel verification (${LIVE ? "LIVE — will post" : "dry-run — no IG post"}) ===\n`);

  // 1. Render + upload the 4 slides.
  const svc = createCardService({ supabase, logger: log });
  const slides = await svc.getCarouselSlideUrls({ story: STORY });
  if (!slides || !slides.length) throw new Error("getCarouselSlideUrls returned null — see WARN above (render/upload failed)");
  console.log(`1. render+upload OK  ${slides.length} slides`);
  slides.forEach((s) => console.log(`     [${s.index}] ${s.slideType.padEnd(6)} ${s.url}`));

  // 2. Each URL must be publicly fetchable AND JPEG.
  for (const s of slides) {
    const res = await fetch(s.url);
    const ct = res.headers.get("content-type") || "";
    const bytes = Buffer.from(await res.arrayBuffer());
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const ok = res.ok && /jpeg|jpg/i.test(ct) && isJpeg;
    console.log(`2.[${s.index}] public ${ok ? "OK " : "FAIL"} ${res.status} ${ct} ${bytes.length}b jpeg=${isJpeg}`);
    if (!ok) throw new Error(`slide ${s.index} not a public JPEG (status=${res.status} ct=${ct} jpeg=${isJpeg})`);
  }

  // 3. Assemble + (optionally) run the Graph carousel publish.
  let creds;
  try {
    creds = ig.credsFromEnv(process.env);
    console.log(`3. creds         OK  ig_user=${creds.igUserId} graph=${creds.graphVersion}`);
  } catch (e) {
    if (LIVE) throw e;
    creds = { igUserId: "DRYRUN_IG_USER", accessToken: "DRYRUN", graphVersion: "v21.0" };
    console.log(`3. creds         (none set — using synthetic creds for dry-run: ${e.message})`);
  }

  const result = await ig.publish(
    { post_text: "Today's news in 5 questions. (verification — ignore)" },
    { creds, slides, logger: log, dryRun: !LIVE }
  );
  console.log(`4. publish       OK  ${LIVE ? "media_id=" + result.platformPostId : "DRY-RUN " + result.platformPostId}`);

  if (LIVE) {
    console.log(`\n✅ Posted a real carousel to Instagram. Verify it on the @quydly profile and store media_id=${result.platformPostId}.`);
  } else {
    console.log("\n✅ Render + upload + public-JPEG checks pass; carousel request assembles correctly.");
    console.log("   No Instagram post was made. Re-run with --live (and creds set) to publish for real.\n");
  }
} catch (err) {
  console.error("\n❌ Verification FAILED:", err.message);
  process.exit(1);
}

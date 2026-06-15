#!/usr/bin/env node
// Dry-run verification for the Facebook Page publishing path — posts NOTHING to
// Facebook by default. It:
//   1. Runs the deterministic Facebook caption formatter on a synthetic story.
//   2. Assembles the full Graph API /photos request in DRY-RUN (no Meta call)
//      and asserts the request shape (url + caption).
//   3. Confirms credsFromEnv resolves from local.settings.json env (FACEBOOK_PAGE_ID
//      + META_PAGE_ACCESS_TOKEN). When unset it falls back to synthetic creds for
//      the dry-run rather than failing.
//
// Usage:
//   node test/verify-fb-feed.js          # dry-run (safe, no FB post)
//   node test/verify-fb-feed.js --live   # ACTUALLY publishes to the Facebook Page
//
// IMPORTANT: --live publishes a REAL Page post and requires a META_PAGE_ACCESS_TOKEN
// that carries the `pages_manage_posts` permission. The current token does NOT have
// it, so --live WILL fail at Graph until the token is re-minted. --live is guarded:
// it additionally requires the explicit --i-understand-this-posts-for-real flag and
// prints a loud warning before doing anything.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import * as facebook from "../lib/social/platforms/facebook.js";
import * as fb from "../lib/social/facebook-graph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
Object.assign(process.env, settings.Values);

const LIVE = process.argv.includes("--live");
const CONFIRMED = process.argv.includes("--i-understand-this-posts-for-real");

const log = Object.assign((...a) => console.log(...a), {
  warn: (...a) => console.warn("[WARN]", ...a),
  error: (...a) => console.error("[ERROR]", ...a),
});

const STORY = {
  id: "verify-fb",
  category_id: "finance",
  headline: "Facebook path verification — Quydly daily news quiz",
  summary: "This is a synthetic story used only to verify the Facebook Page publish path. It posts nothing unless --live is passed. Second sentence keeps the formatter honest.",
  key_points: [
    "The Facebook caption is rendered by the deterministic formatter",
    "The post format is a single square card image plus caption",
    "Publishing uses POST /{pageId}/photos with a public HTTPS image url",
  ],
};

// A stand-in public HTTPS card url. In production the card service uploads a real
// 1080×1080 JPEG to Supabase Storage and sets it on post.media_url.
const CARD_URL = "https://example.com/cards/verify-fb/square.jpg";

async function main() {
  console.log(`\n=== Facebook Page verification (${LIVE ? "LIVE — will post" : "dry-run — no FB post"}) ===\n`);

  if (LIVE && !CONFIRMED) {
    console.error("❌ Refusing to run --live without --i-understand-this-posts-for-real.");
    console.error("   --live publishes a REAL post to the Quydly Facebook Page and requires a");
    console.error("   META_PAGE_ACCESS_TOKEN with the pages_manage_posts permission (the current");
    console.error("   token does NOT have it — Graph will reject the publish).");
    process.exit(1);
  }
  if (LIVE) {
    console.warn("[WARN] --live: this WILL post a real photo to the Quydly Facebook Page.");
  }

  // 1. Deterministic caption.
  const draft = facebook.format(STORY, "global");
  if (!draft.text || draft.text.length > facebook.CONSTRAINTS.maxLength) {
    throw new Error(`caption invalid (len=${draft.text?.length})`);
  }
  console.log(`1. format        OK  caption ${draft.text.length} chars`);

  // 2. Creds (real if set, synthetic for dry-run).
  let creds;
  try {
    creds = fb.credsFromEnv(process.env);
    console.log(`2. creds         OK  page_id=${creds.pageId} graph=${creds.graphVersion}`);
  } catch (e) {
    if (LIVE) throw e;
    creds = { pageId: "DRYRUN_PAGE", accessToken: "DRYRUN", graphVersion: "v21.0" };
    console.log(`2. creds         (none set — synthetic creds for dry-run: ${e.message})`);
  }

  // 3. Assemble + (optionally) run the /photos publish.
  const post = { post_text: draft.text, media_url: CARD_URL };

  // In dry-run, capture the assembled request via a fetch stub that is never
  // actually called (dryRun short-circuits before any fetch) — we assert the
  // returned synthetic shape instead.
  const result = await fb.publish(post, { creds, dryRun: !LIVE, logger: log });

  if (!LIVE) {
    // Assert the dry-run echoes the /photos request fields the publisher will send.
    if (result.platformPostId !== "DRYRUN-fb-photo") {
      throw new Error(`unexpected dry-run id: ${result.platformPostId}`);
    }
    if (result.rawResponse.url !== CARD_URL) throw new Error("dry-run url mismatch");
    if (result.rawResponse.caption !== draft.text) throw new Error("dry-run caption mismatch");
    console.log("3. publish       OK  DRY-RUN assembled /photos request:");
    console.log(`     POST /${creds.pageId}/photos`);
    console.log(`       url     = ${result.rawResponse.url}`);
    console.log(`       caption = ${JSON.stringify(result.rawResponse.caption.slice(0, 60))}…`);
    console.log("\n✅ Caption renders, creds resolve, and the /photos request assembles correctly.");
    console.log("   No Facebook post was made.\n");
  } else {
    console.log(`3. publish       OK  post_id=${result.platformPostId}`);
    console.log(`\n✅ Posted a real photo to the Quydly Facebook Page. post_id=${result.platformPostId}.`);
  }
}

main().catch((err) => {
  console.error("\n❌ Verification FAILED:", err.message);
  process.exit(1);
});

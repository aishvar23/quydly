#!/usr/bin/env node
// Live verification for the headline-card media path. Exercises the two
// integrations that have never run against real services — Supabase Storage
// (bucket create + upload + public URL) and X v1.1 media/upload (OAuth 1.0a
// multipart) — WITHOUT publishing a tweet. An X media upload returns an
// unattached media_id that is invisible until used in a tweet and auto-expires
// (~24h) if unused, so this posts nothing public.
//
// Usage: node test/verify-social-cards.js

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

import { renderStoryCard } from "../lib/social/card-renderer.js";
import { createCardService } from "../lib/social/card-storage.js";
import { uploadMedia } from "../lib/social/platforms/x.js";
import { credsFromEnv } from "../lib/social/x-oauth1.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(readFileSync(join(__dirname, "..", "local.settings.json"), "utf8"));
Object.assign(process.env, settings.Values);

const log = Object.assign((...a) => console.log(...a), {
  warn: (...a) => console.warn("[WARN]", ...a),
  error: (...a) => console.error("[ERROR]", ...a),
});

const STORY = {
  id: "verify",
  category_id: "finance",
  headline: "Card path verification — Quydly daily news quiz",
};

try {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  console.log("\n=== Headline-card media path verification (no tweet posted) ===\n");

  // 1. Render
  const { buffer, contentType, width, height } = await renderStoryCard(STORY, { shape: "landscape" });
  console.log(`1. render        OK  ${width}x${height} ${contentType} ${buffer.length} bytes`);

  // 2. Supabase Storage: bucket create + upload + public URL
  const svc = createCardService({ supabase, logger: log });
  const url = await svc.getCardUrl({ story: STORY, shape: "landscape" });
  if (!url) throw new Error("getCardUrl returned null — see WARN above (bucket/upload failed)");
  console.log(`2. supabase      OK  ${url}`);

  // 2b. Confirm the URL is publicly fetchable and is the PNG
  const fetched = await fetch(url);
  const ct = fetched.headers.get("content-type");
  const bytes = Buffer.from(await fetched.arrayBuffer());
  console.log(`   public fetch  ${fetched.ok ? "OK" : "FAIL"}  ${fetched.status} ${ct} ${bytes.length} bytes`);
  if (!fetched.ok) throw new Error(`public URL not fetchable: ${fetched.status}`);

  // 3. X media upload (OAuth 1.0a multipart) — returns an unattached media_id
  const creds = credsFromEnv(process.env);
  const mediaId = await uploadMedia(buffer, contentType, { creds });
  console.log(`3. x media       OK  media_id=${mediaId}  (unattached, not a tweet)`);

  console.log("\n✅ All three live integrations work. Safe to enable SOCIAL_CARDS_ENABLED.");
  console.log("   The next post (auto or manual) will carry the card; verify it by reading the tweet back.\n");
} catch (err) {
  console.error("\n❌ Verification FAILED:", err.message);
  console.error("   Do NOT enable cards until this passes (posts would silently drop to text-only).\n");
  process.exit(1);
}

// Story-card storage. Design §8 (reach).
//
// Renders a branded card (card-renderer) and uploads it to Supabase Storage,
// returning a public URL. The URL is stored on social_posts.media_url so:
//   - Instagram (Graph API) can publish from a public image URL, and
//   - the X publisher can re-download the bytes to attach as native media.
//
//   createCardService({ supabase, env, logger }) → { getCardUrl({ story, shape }) }
//
// getCardUrl is memoised per (story.id, shape) for the lifetime of the service
// so one story renders each shape at most once across the platform loop.

import { createHash } from "node:crypto";
import { renderStoryCard, renderCarouselSlides } from "./card-renderer.js";
import { generateIllustrations } from "./illustration.js";

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

// Carousel slides now depend on whyItMatters (the LLM "Why it matters" block),
// so the per-story memo must key on those points too — otherwise an earlier
// empty/fallback render would be returned for a later call that did produce
// points, silently dropping the new block. "nowhy" for the empty case.
function whyFingerprint(whyItMatters) {
  if (!Array.isArray(whyItMatters) || whyItMatters.length === 0) return "nowhy";
  return createHash("sha1").update(JSON.stringify(whyItMatters)).digest("hex").slice(0, 12);
}

// The engagement MCQ is also part of the rendered slide set, so the per-story
// memo must key on it too — otherwise an earlier render (e.g. no question) would
// be returned for a later call that did produce one, dropping the engagement
// slide. "noq" for the empty case; fingerprints the question+options otherwise.
function questionFingerprint(question) {
  if (!question || !question.question) return "noq";
  const seed = JSON.stringify([question.question, question.options, question.correctIndex]);
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

// The cover hook AND its highlighted span are rendered onto the cover slide, so
// both are part of the slide bytes — the memo key and object path must fingerprint
// them, otherwise a hooked/highlighted render would collide with an earlier one.
// "nohook" when the hook is empty.
function hookFingerprint(coverHook, coverHighlight) {
  const h = typeof coverHook === "string" ? coverHook.trim() : "";
  if (!h) return "nohook";
  const hl = typeof coverHighlight === "string" ? coverHighlight.trim() : "";
  // Length-prefix the hook so (hook, highlight) pairs can't collide by
  // concatenation (e.g. ("ab","c") vs ("a","bc")).
  return createHash("sha1").update(`${h.length}:${h}:${hl}`).digest("hex").slice(0, 12);
}

// A resolved football match drives the whole slide set (score/table/form), so it
// is part of the slide bytes — fingerprint the match id + score + competition so
// a corrected score re-renders to a FRESH path (never serves stale slides).
// "nofb" for a non-football render.
function footballFingerprint(football) {
  if (!football || !football.match) return "nofb";
  const m = football.match;
  const seed = JSON.stringify([m.id, m.score?.home, m.score?.away, football.competition?.code]);
  return createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

export function createCardService({ supabase, env = process.env, logger = noopLogger } = {}) {
  const bucket = env.SOCIAL_CARDS_BUCKET || "social-cards";
  // When on, carousel cover slides for person-led stories carry a licensed
  // portrait inset (card-renderer leadPersonPortrait). Off → text-only covers.
  // Cover image is core to the redesign, so it is ON by default — disable only
  // with an explicit SOCIAL_IG_PORTRAIT_ENABLED=false/0. Image fetch is
  // best-effort (a failure leaves a clean text cover), so default-on is safe.
  const igPortrait = !/^(0|false)$/i.test(String(env.SOCIAL_IG_PORTRAIT_ENABLED || ""));
  // Editorial illustration (Tier 2) requires an OpenAI key; on by default once
  // the key is present, disable with SOCIAL_IG_ILLUSTRATION_ENABLED=false/0.
  const openaiKey = env.OPENAI_API_KEY || "";
  const igIllustration = !!openaiKey && !/^(0|false)$/i.test(String(env.SOCIAL_IG_ILLUSTRATION_ENABLED || ""));
  const cache = new Map(); // `${storyId}:${shape}` → Promise<string|null>
  let bucketReady = null;

  // Ensure the (public) bucket exists. Idempotent; a "already exists" error is
  // success. Best-effort: a failure here surfaces on the upload call instead.
  async function ensureBucket() {
    if (!bucketReady) {
      bucketReady = (async () => {
        const { error } = await supabase.storage.createBucket(bucket, { public: true });
        if (error && !/exist/i.test(error.message || "")) {
          logger.warn(JSON.stringify({ event: "social_card_bucket_warn", bucket, error: error.message }));
        }
      })();
    }
    return bucketReady;
  }

  // Upload one rendered image and return its public URL.
  async function upload({ path, buffer, contentType }) {
    await ensureBucket();
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    const url = data && data.publicUrl;
    if (!url) throw new Error("no public URL returned");
    return url;
  }

  async function buildCard({ story, shape, format }) {
    const ext = format === "jpeg" || format === "jpg" ? "jpg" : "png";
    const { buffer, contentType } = await renderStoryCard(story, { shape, format });
    return upload({ path: `cards/${story.id}/${shape}.${ext}`, buffer, contentType });
  }

  // Render + upload every carousel slide. Returns an ordered array of
  // { url, index, slideType, width, height, contentType } — order IS publish order.
  //
  // `variant` (whyFingerprint-questionFingerprint) is part of the object PATH, not
  // just the in-memory cache key: the slide bytes differ by whyItMatters AND the
  // engagement question (which is sourced per audience_geo / previous post), so two
  // renders of the same story with different content must NOT share a storage URL.
  // Keying only on story.id let a later render upsert-overwrite an earlier post's
  // slide, so that post could publish the wrong engagement question while its
  // social_post_engagement row still held the original Q&A (wrong 12h answer).
  async function buildCarousel({ story, whyItMatters = [], question = null, coverHook = null, coverHighlight = null, illustrationUrls = [], football = null, variant }) {
    const slides = await renderCarouselSlides(story, { withPortrait: igPortrait, whyItMatters, question, coverHook, coverHighlight, illustrationUrls, football }); // JPEG (Instagram requires it)
    const out = [];
    for (const s of slides) {
      const path = `cards/${story.id}/carousel/${variant}/${s.index}-${s.slideType}.jpg`;
      const url = await upload({ path, buffer: s.buffer, contentType: s.contentType });
      out.push({ url, index: s.index, slideType: s.slideType, width: s.width, height: s.height, contentType: s.contentType });
    }
    return out;
  }

  // Generate `count` DISTINCT editorial illustrations for a photoless story and
  // upload each — the Tier-2 per-slide imagery. Returns an array aligned to the
  // slots (null where a scene/image/upload failed). Best-effort: the renderer
  // falls back to the brand-graphic floor for any null slot. Memoised so the
  // expensive generation runs at most once per (story, count).
  async function buildIllustrations({ story, anthropic, count }) {
    const results = await generateIllustrations({ anthropic, openaiKey, story, count, logger });
    return Promise.all(results.map(async (r, i) => {
      if (!r) return null;
      try {
        return await upload({ path: `cards/${story.id}/illustration-${i}.png`, buffer: r.buffer, contentType: r.contentType });
      } catch (err) {
        logger.warn(JSON.stringify({ event: "social_illustration_upload_failed", story_id: story.id, index: i, error: err.message }));
        return null;
      }
    }));
  }

  return {
    // Returns an array of up to `count` illustration URLs (null per failed slot),
    // or [] when disabled / no client / generation fails.
    async getIllustrationUrls({ story, anthropic, count = 1 } = {}) {
      if (!igIllustration || !anthropic || !story || story.id == null || count < 1) return [];
      const key = `${story.id}:illustrations:${count}`;
      if (cache.has(key)) return cache.get(key);
      const p = buildIllustrations({ story, anthropic, count }).catch((err) => {
        logger.warn(JSON.stringify({ event: "social_illustration_failed", story_id: story.id, error: err.message }));
        return [];
      });
      cache.set(key, p);
      return p;
    },

    // Returns a public card URL, or null on any failure (caller proceeds without
    // media — X posts text-only; Instagram stays media-gated, as before).
    async getCardUrl({ story, shape = "landscape", format = "png" }) {
      if (!story || story.id == null) return null;
      const key = `${story.id}:${shape}:${format}`;
      if (cache.has(key)) return cache.get(key);
      const p = buildCard({ story, shape, format }).catch((err) => {
        logger.warn(JSON.stringify({
          event: "social_card_failed", story_id: story.id, shape, error: err.message,
        }));
        return null;
      });
      cache.set(key, p);
      return p;
    },

    // Returns the ordered carousel slide descriptors, or null on any failure
    // (caller proceeds without media — Instagram stays media-gated). Memoised
    // per story for the service's lifetime.
    async getCarouselSlideUrls({ story, whyItMatters = [], question = null, coverHook = null, coverHighlight = null, illustrationUrls = [], football = null }) {
      if (!story || story.id == null) return null;
      // One fingerprint drives BOTH the memo key and the storage object path, so a
      // distinct (whyItMatters, question, coverHook+highlight, #illustrations,
      // football match) variant never overwrites another's bytes.
      const illCount = (Array.isArray(illustrationUrls) ? illustrationUrls : []).filter(Boolean).length;
      const variant = `${whyFingerprint(whyItMatters)}-${questionFingerprint(question)}-${hookFingerprint(coverHook, coverHighlight)}-${illCount ? `ill${illCount}` : "noill"}-${footballFingerprint(football)}`;
      const key = `${story.id}:carousel:${variant}`;
      if (cache.has(key)) return cache.get(key);
      const p = buildCarousel({ story, whyItMatters, question, coverHook, coverHighlight, illustrationUrls, football, variant }).catch((err) => {
        logger.warn(JSON.stringify({
          event: "social_carousel_failed", story_id: story.id, error: err.message,
        }));
        return null;
      });
      cache.set(key, p);
      return p;
    },
  };
}

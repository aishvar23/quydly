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

import { renderStoryCard, renderCarouselSlides } from "./card-renderer.js";

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

export function createCardService({ supabase, env = process.env, logger = noopLogger } = {}) {
  const bucket = env.SOCIAL_CARDS_BUCKET || "social-cards";
  // When on, carousel cover slides for person-led stories carry a licensed
  // portrait inset (card-renderer leadPersonPortrait). Off → text-only covers.
  const igPortrait = /^(1|true)$/i.test(String(env.SOCIAL_IG_PORTRAIT_ENABLED || ""));
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
  async function buildCarousel({ story, whyItMatters = [] }) {
    const slides = await renderCarouselSlides(story, { withPortrait: igPortrait, whyItMatters }); // JPEG (Instagram requires it)
    const out = [];
    for (const s of slides) {
      const path = `cards/${story.id}/carousel/${s.index}-${s.slideType}.jpg`;
      const url = await upload({ path, buffer: s.buffer, contentType: s.contentType });
      out.push({ url, index: s.index, slideType: s.slideType, width: s.width, height: s.height, contentType: s.contentType });
    }
    return out;
  }

  return {
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
    async getCarouselSlideUrls({ story, whyItMatters = [] }) {
      if (!story || story.id == null) return null;
      const key = `${story.id}:carousel`;
      if (cache.has(key)) return cache.get(key);
      const p = buildCarousel({ story, whyItMatters }).catch((err) => {
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

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

import { renderStoryCard } from "./card-renderer.js";

const noopLogger = Object.assign(() => {}, { warn: () => {}, error: () => {} });

export function createCardService({ supabase, env = process.env, logger = noopLogger } = {}) {
  const bucket = env.SOCIAL_CARDS_BUCKET || "social-cards";
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

  async function build({ story, shape }) {
    await ensureBucket();
    const { buffer, contentType } = await renderStoryCard(story, { shape });
    const path = `cards/${story.id}/${shape}.png`;

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert: true });
    if (upErr) throw new Error(upErr.message);

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    const url = data && data.publicUrl;
    if (!url) throw new Error("no public URL returned");
    return url;
  }

  return {
    // Returns a public card URL, or null on any failure (caller proceeds without
    // media — X posts text-only; Instagram stays media-gated, as before).
    async getCardUrl({ story, shape = "landscape" }) {
      if (!story || story.id == null) return null;
      const key = `${story.id}:${shape}`;
      if (cache.has(key)) return cache.get(key);
      const p = build({ story, shape }).catch((err) => {
        logger.warn(JSON.stringify({
          event: "social_card_failed", story_id: story.id, shape, error: err.message,
        }));
        return null;
      });
      cache.set(key, p);
      return p;
    },
  };
}

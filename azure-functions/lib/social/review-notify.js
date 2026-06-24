// Review-queue email alert for Instagram carousels that can't get real cover
// imagery. When an auto-approved carousel's cover would ship with only a logo/flag
// or the bare gradient (no licensed photo AND no editorial illustration), the
// generator holds it as PENDING_REVIEW instead of auto-posting and calls this to
// email the review address, so a human can attach imagery or approve it as-is.
//
// Best-effort and dependency-free: it calls Resend's REST API via fetch (the
// Function App already uses Resend elsewhere) and no-ops when RESEND_API_KEY is
// unset. Any failure is logged and swallowed — a missed alert must never block or
// fail post generation (the post is already safely held for review).

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_REVIEW_EMAIL = "aishvar.suhane@gmail.com";
const DEFAULT_FROM = "Quydly <noreply@quydly.com>";

// Human-readable reason for the chosen weak-imagery state.
function reasonFor(coverImagery) {
  return coverImagery === "logo"
    ? "only a logo / flag (no licensed photo and no editorial illustration)"
    : "no imagery at all — the bare gradient fallback";
}

export async function notifyCoverHeldForReview({ story, post, coverImagery, env = {}, fetchImpl = fetch, logger } = {}) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    logger?.warn?.(JSON.stringify({ event: "social_review_email_skipped", reason: "no_resend_key", story_id: story?.id }));
    return false;
  }
  const to = env.SOCIAL_REVIEW_EMAIL || DEFAULT_REVIEW_EMAIL;
  const from = env.FROM_EMAIL || DEFAULT_FROM;
  const subject = `[Quydly] IG carousel held for review — weak cover imagery (story ${story?.id ?? "?"})`;
  const text = [
    `An Instagram carousel was held for manual review (not auto-posted) because its`,
    `cover has ${reasonFor(coverImagery)}.`,
    ``,
    `Story:    ${story?.headline || "(untitled)"}`,
    `Story id: ${story?.id ?? "?"}  ·  category: ${story?.category_id || "?"}`,
    `Audience: ${post?.audienceGeo || "?"}`,
    `Cover imagery: ${coverImagery}`,
    ``,
    `It is sitting in the review queue as PENDING_REVIEW. Attach a photo/illustration`,
    `or approve it as-is to publish.`,
  ].join("\n");

  try {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res || !res.ok) {
      logger?.warn?.(JSON.stringify({ event: "social_review_email_http", status: res?.status, story_id: story?.id }));
      return false;
    }
    logger?.warn?.(JSON.stringify({ event: "social_review_email_sent", story_id: story?.id, to, cover_imagery: coverImagery }));
    return true;
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "social_review_email_failed", story_id: story?.id, error: err.message }));
    return false;
  }
}

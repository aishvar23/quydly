// Review-queue email alert for Instagram carousels that can't get real cover
// imagery. When an auto-approved carousel's cover would ship with only a logo/flag
// or the bare gradient (no licensed photo AND no editorial illustration), the
// generator holds it as PENDING_REVIEW instead of auto-posting and calls this to
// email the review address. The email carries one-tap Approve / Reject buttons
// (signed links to the /api/social-review endpoint) so the decision can be made
// from a phone with no login — see api/social-review.js for the other half.
//
// Best-effort and dependency-free: it calls Resend's REST API via fetch (the
// Function App already uses Resend elsewhere) and no-ops when RESEND_API_KEY is
// unset. Any failure is logged and swallowed — a missed alert must never block or
// fail post generation (the post is already safely held for review).

import { createHmac } from "node:crypto";

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_REVIEW_EMAIL = "aishvar.suhane@gmail.com";
const DEFAULT_FROM = "Quydly <noreply@quydly.com>";
const DEFAULT_BASE_URL = "https://quydly.com";

// Human-readable reason for the chosen weak-imagery state.
function reasonFor(coverImagery) {
  return coverImagery === "logo"
    ? "only a logo / flag (no licensed photo and no editorial illustration)"
    : "no imagery at all — the bare gradient fallback";
}

// HMAC-SHA256 over "<postId>:<action>" with SOCIAL_REVIEW_SECRET — the same token
// api/social-review.js recomputes to authorise the action. MUST stay in sync with
// that endpoint's `expectedToken`.
function signAction(postId, action, secret) {
  return createHmac("sha256", secret).update(`${postId}:${action}`).digest("hex");
}

// The signed Approve / Reject action links, or null when we can't build them
// (no secret or no post id → the email still sends, just without buttons).
function actionLinks({ postId, env }) {
  const secret = env.SOCIAL_REVIEW_SECRET;
  if (!secret || !postId) return null;
  const base = String(env.SOCIAL_REVIEW_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const link = (action) =>
    `${base}/api/social-review?post=${encodeURIComponent(postId)}&action=${action}&token=${signAction(postId, action, secret)}`;
  return { approve: link("approve"), reject: link("reject") };
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function htmlBody({ story, post, coverImagery, links }) {
  const button = (href, label, bg) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:14px 28px;margin:0 8px 8px 0;border-radius:10px;background:${bg};color:#fff;font-weight:700;text-decoration:none;font-family:Arial,sans-serif">${label}</a>`;
  const actions = links
    ? `<p style="margin:20px 0 8px">${button(links.approve, "✓ Approve &amp; post", "#16a34a")}${button(links.reject, "✕ Reject", "#dc2626")}</p>
       <p style="font:12px Arial,sans-serif;color:#6b7280;margin:4px 0 0">You'll see a quick confirm screen before anything changes.</p>`
    : `<p style="font:13px Arial,sans-serif;color:#6b7280">Open the review queue to approve or reject.</p>`;
  return `<div style="max-width:560px;font:15px/1.5 Arial,sans-serif;color:#111827">
    <p>An Instagram carousel was <b>held for manual review</b> (not auto-posted) because its cover has ${esc(reasonFor(coverImagery))}.</p>
    <table style="font:14px Arial,sans-serif;color:#374151;border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Story</td><td><b>${esc(story?.headline || "(untitled)")}</b></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Story id</td><td>${esc(story?.id ?? "?")} &middot; ${esc(story?.category_id || "?")}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Audience</td><td>${esc(post?.audienceGeo || "?")}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Cover imagery</td><td>${esc(coverImagery)}</td></tr>
    </table>
    ${actions}
  </div>`;
}

function textBody({ story, post, coverImagery, links }) {
  const lines = [
    `An Instagram carousel was held for manual review (not auto-posted) because its`,
    `cover has ${reasonFor(coverImagery)}.`,
    ``,
    `Story:    ${story?.headline || "(untitled)"}`,
    `Story id: ${story?.id ?? "?"}  ·  category: ${story?.category_id || "?"}`,
    `Audience: ${post?.audienceGeo || "?"}`,
    `Cover imagery: ${coverImagery}`,
    ``,
  ];
  if (links) {
    lines.push(`Approve & post:  ${links.approve}`, `Reject:          ${links.reject}`, ``,
      `(Each opens a quick confirm screen first.)`);
  } else {
    lines.push(`It is sitting in the review queue as PENDING_REVIEW. Approve or reject it there.`);
  }
  return lines.join("\n");
}

export async function notifyCoverHeldForReview({ story, post, postId, coverImagery, env = {}, fetchImpl = fetch, logger } = {}) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    logger?.warn?.(JSON.stringify({ event: "social_review_email_skipped", reason: "no_resend_key", story_id: story?.id }));
    return false;
  }
  const to = env.SOCIAL_REVIEW_EMAIL || DEFAULT_REVIEW_EMAIL;
  const from = env.FROM_EMAIL || DEFAULT_FROM;
  const links = actionLinks({ postId, env });
  const subject = `[Quydly] IG carousel held for review — weak cover imagery (story ${story?.id ?? "?"})`;
  const html = htmlBody({ story, post, coverImagery, links });
  const text = textBody({ story, post, coverImagery, links });

  try {
    const res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res || !res.ok) {
      logger?.warn?.(JSON.stringify({ event: "social_review_email_http", status: res?.status, story_id: story?.id }));
      return false;
    }
    logger?.warn?.(JSON.stringify({ event: "social_review_email_sent", story_id: story?.id, to, cover_imagery: coverImagery, actionable: !!links }));
    return true;
  } catch (err) {
    logger?.warn?.(JSON.stringify({ event: "social_review_email_failed", story_id: story?.id, error: err.message }));
    return false;
  }
}

// Public, login-free Approve/Reject endpoint for Instagram carousels held in the
// review queue (status PENDING_REVIEW). The hold email (azure-functions/lib/social/
// review-notify.js) links here with a signed token, so the reviewer can decide
// from their phone with one tap.
//
// Security:
//   • Every action requires a valid, UNEXPIRED token: HMAC-SHA256 over
//     "<postId>:<action>:<exp>" keyed by SOCIAL_REVIEW_SECRET (the same secret the
//     email signs with — see review-token.js, shared by both halves).
//   • GET only RENDERS a confirm page — it never mutates — so email/link
//     prefetchers (Gmail/Outlook fetch links) can't auto-approve. The status
//     change happens on the POST from that page's button.
//   • The update is gated to status = 'PENDING_REVIEW' and can only set
//     'APPROVED' or 'REJECTED' — no other row or field is touchable, and a
//     re-tap on an already-decided post is a no-op.
//
// Approve → APPROVED (the publisher posts it as-is). Reject → REJECTED (terminal,
// never posts). Requires SOCIAL_REVIEW_SECRET + SUPABASE_URL + SUPABASE_SERVICE_KEY
// in the Vercel project env.

import { reviewTokenValid } from "../azure-functions/lib/social/review-token.js";

const ACTION_STATUS = { approve: "APPROVED", reject: "REJECTED" };

// Lazy so `core` (and its tests) can load without the Supabase package present.
async function buildSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// HTML-escape a value reflected into the page (e.g. the story headline) so markup
// in the data can't break the layout or inject script into the reviewer's browser.
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ── Minimal mobile-friendly HTML ──────────────────────────────────────────────
function shell(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title></head>
<body style="margin:0;background:#0B0F1A;color:#fff;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="font-weight:700;letter-spacing:1px;color:#fff;margin-bottom:24px">QUYDLY</div>
${bodyHtml}
</div></body></html>`;
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function message(res, status, title, body) {
  return sendHtml(res, status, shell(title, `<h2 style="margin:0 0 12px">${title}</h2><p style="color:#cbd5e1">${body}</p>`));
}

function confirmPage(res, { post, action, exp, token, headline }) {
  const verb = action === "approve" ? "Approve &amp; post" : "Reject";
  const accent = action === "approve" ? "#16a34a" : "#dc2626";
  const sub = action === "approve"
    ? "This carousel will be published as-is (its cover has no photo or illustration)."
    : "This carousel will be rejected and never posted.";
  // The form POSTs back to this same URL (query carries post/action/exp/token); the
  // mutation only happens here, on submit — not on the GET that rendered this.
  const formAction = `/api/social-review?post=${encodeURIComponent(post)}&action=${encodeURIComponent(action)}&exp=${encodeURIComponent(exp)}&token=${encodeURIComponent(token)}`;
  return sendHtml(res, 200, shell(`${verb}?`, `
    <h2 style="margin:0 0 8px">${verb}?</h2>
    ${headline ? `<p style="color:#e5e7eb;margin:0 0 4px"><b>${esc(headline)}</b></p>` : ""}
    <p style="color:#94a3b8;margin:0 0 24px">${sub}</p>
    <form method="POST" action="${formAction}">
      <button type="submit" style="display:block;width:100%;padding:16px;border:0;border-radius:12px;background:${accent};color:#fff;font-size:17px;font-weight:700">${verb}</button>
    </form>`));
}

// Core handler with an injectable Supabase client (for tests).
export async function core(req, res, supabase) {
  const secret = process.env.SOCIAL_REVIEW_SECRET;
  const q = req.query || {};
  const post = String(q.post || "");
  const action = String(q.action || "");
  const exp = String(q.exp || "");
  const token = String(q.token || "");

  if (!ACTION_STATUS[action] || !post) {
    return message(res, 400, "Invalid link", "This review link is malformed.");
  }
  if (!secret) {
    return message(res, 500, "Not configured", "Review actions aren’t configured on the server.");
  }
  if (!reviewTokenValid({ postId: post, action, exp, token, secret })) {
    return message(res, 403, "Link could not be verified", "This review link is invalid, has expired, or has been tampered with.");
  }

  // GET → confirm screen only (prefetch-safe). Look up the headline for context.
  if (req.method === "GET") {
    let headline = "";
    try {
      const { data } = await supabase.from("social_posts").select("stories(headline)").eq("id", post).maybeSingle();
      headline = data?.stories?.headline || "";
    } catch { /* non-fatal — confirm page still renders without it */ }
    return confirmPage(res, { post, action, exp, token, headline });
  }

  if (req.method === "POST") {
    const target = ACTION_STATUS[action];
    // Single gated write: only a still-PENDING_REVIEW row flips, so concurrent
    // approve/reject calls resolve to exactly one winner (the rest match 0 rows).
    const { data, error } = await supabase
      .from("social_posts")
      .update({ status: target })
      .eq("id", post)
      .eq("status", "PENDING_REVIEW")
      .select("id");
    if (error) {
      return message(res, 500, "Something went wrong", "Could not update the post. Please try again.");
    }
    if (!data || !data.length) {
      // Already decided (or gone) — no second query; the action is simply a no-op.
      return message(res, 200, "Already handled",
        "No change made — this post is no longer awaiting review (it was already approved, rejected, or posted).");
    }
    return message(res, 200, action === "approve" ? "Approved ✓" : "Rejected",
      action === "approve"
        ? "The carousel is approved and will be posted on the next publish run."
        : "The carousel has been rejected and will not be posted.");
  }

  res.setHeader("Allow", "GET, POST");
  return message(res, 405, "Method not allowed", "");
}

export default async function handler(req, res) {
  return core(req, res, await buildSupabase());
}

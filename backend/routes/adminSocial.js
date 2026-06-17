// Admin Social Review UI — Phase 3 (design §11).
//
// Server-rendered review console mounted at /admin/social (Express, per D3).
// Sections: Pending Review / Approved-Scheduled / Posted / Failed / Rejected.
// MVP actions (§11.4): approve, reject, edit text, publish now.
//
// Auth: a shared ADMIN_TOKEN (env). The token is exchanged for an httpOnly
// cookie via the login form; every route is gated by requireAdmin.

import express, { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { tokenMatches } from "../lib/adminAuth.js";

const router = Router();
router.use(express.urlencoded({ extended: false }));

const COOKIE = "qsa_admin";
const BASE = "/admin/social";

function buildSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function requireAdmin(req, res, next) {
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).send(page("Setup required", `<p class="err">ADMIN_TOKEN is not configured on the server.</p>`));
  }
  const provided = parseCookies(req)[COOKIE] || req.headers["x-admin-token"];
  if (tokenMatches(provided)) return next();
  return res.status(401).send(loginPage());
}

// ── HTML helpers ────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE = `
  :root { font-family: system-ui, sans-serif; }
  body { margin: 0; background: #0f1115; color: #e7e9ee; }
  header { padding: 14px 20px; background: #161922; border-bottom: 1px solid #232838; display:flex; justify-content:space-between; align-items:center; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 14px; color:#9aa3b2; text-transform:uppercase; letter-spacing:.06em; margin: 28px 20px 8px; }
  main { padding: 0 20px 60px; }
  .card { background:#161922; border:1px solid #232838; border-radius:10px; padding:14px 16px; margin:12px 0; }
  .meta { font-size:12px; color:#9aa3b2; display:flex; gap:14px; flex-wrap:wrap; margin-bottom:8px; }
  .headline { font-weight:600; margin-bottom:6px; }
  .summary { font-size:13px; color:#c2c8d4; margin-bottom:10px; }
  .platform { border-top:1px solid #232838; padding:10px 0; }
  .ptitle { font-size:12px; font-weight:600; text-transform:uppercase; color:#9aa3b2; display:flex; gap:8px; align-items:center; }
  textarea { width:100%; box-sizing:border-box; background:#0f1115; color:#e7e9ee; border:1px solid #2b3142; border-radius:6px; padding:8px; font:13px/1.5 system-ui; min-height:78px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:8px; }
  button { cursor:pointer; border:0; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; }
  .approve { background:#1f9d55; color:#fff; } .reject { background:#3a2030; color:#ff9aa9; }
  .publish { background:#2563eb; color:#fff; } .save { background:#2b3142; color:#e7e9ee; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; background:#232838; color:#9aa3b2; }
  .badge.PENDING_REVIEW{background:#3a3320;color:#ffd479}.badge.APPROVED{background:#13351f;color:#7ee2a8}
  .badge.POSTED{background:#102a3a;color:#79c7ff}.badge.FAILED{background:#3a1d1d;color:#ff9a9a}
  .badge.REJECTED{background:#2a2030;color:#caa0d8}.badge.SCHEDULED,.badge.PUBLISHING{background:#26314a;color:#9db8ff}
  .warn { color:#ffb454; font-size:11px; } .err { color:#ff9a9a; }
  .sens-HIGH{color:#ff9a9a}.sens-MEDIUM{color:#ffd479}.sens-LOW{color:#7ee2a8}.sens-UNKNOWN{color:#9aa3b2}
  .empty { color:#6b7280; font-size:13px; margin:8px 20px; }
  form.inline { display:inline; } a { color:#79c7ff; }
`;

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Quydly Social</title><style>${STYLE}</style></head>
<body><header><h1>Quydly · Social Review</h1><form class="inline" method="post" action="${BASE}/logout"><button class="save">Sign out</button></form></header><main>${body}</main></body></html>`;
}

function loginPage(error) {
  return page("Sign in", `
    <h2>Admin sign in</h2>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <form method="post" action="${BASE}/login" class="card" style="max-width:360px">
      <p>Enter the admin token to review social posts.</p>
      <input type="password" name="token" placeholder="ADMIN_TOKEN" style="width:100%;box-sizing:border-box;padding:8px;border-radius:6px;border:1px solid #2b3142;background:#0f1115;color:#e7e9ee" autofocus />
      <div class="row"><button class="approve" type="submit">Sign in</button></div>
    </form>`);
}

const SECTIONS = [
  { title: "Pending Review", statuses: ["PENDING_REVIEW"], actionable: true },
  { title: "Approved / Scheduled", statuses: ["APPROVED", "SCHEDULED", "PUBLISHING"], actionable: false },
  { title: "Posted", statuses: ["POSTED"], actionable: false },
  { title: "Failed", statuses: ["FAILED"], actionable: false },
  { title: "Rejected", statuses: ["REJECTED", "SKIPPED"], actionable: false },
];

function actionForm(postId, action, label, cls) {
  return `<form class="inline" method="post" action="${BASE}/posts/${esc(postId)}/${action}"><button class="${cls}" type="submit">${label}</button></form>`;
}

function renderPlatform(post, actionable) {
  const needsMedia = post.platform === "instagram" && !post.media_url;
  const actions = [];
  if (actionable) {
    actions.push(actionForm(post.id, "approve", "Approve", "approve"));
    actions.push(actionForm(post.id, "publish-now", "Publish now", "publish"));
    actions.push(actionForm(post.id, "reject", "Reject", "reject"));
  } else if (["APPROVED", "SCHEDULED"].includes(post.status)) {
    actions.push(actionForm(post.id, "reject", "Reject", "reject"));
  }

  const editable = actionable
    ? `<form method="post" action="${BASE}/posts/${esc(post.id)}/edit">
         <textarea name="post_text">${esc(post.post_text)}</textarea>
         <div class="row"><button class="save" type="submit">Save text</button>
         <span class="meta">${post.post_text.length} chars</span></div>
       </form>`
    : `<div class="summary" style="white-space:pre-wrap">${esc(post.post_text)}</div>`;

  return `<div class="platform">
    <div class="ptitle">${esc(post.platform)} <span class="badge ${esc(post.status)}">${esc(post.status)}</span>
      ${needsMedia ? `<span class="warn">⚠ needs media asset before publish</span>` : ""}
      ${post.error_message ? `<span class="err">${esc(post.error_message)}</span>` : ""}
      ${post.platform_post_id ? `<span class="meta">id ${esc(post.platform_post_id)}</span>` : ""}
    </div>
    ${editable}
    ${actions.length ? `<div class="row">${actions.join("")}</div>` : ""}
  </div>`;
}

function renderCard(group, actionable) {
  const s = group.story || {};
  const c = group.candidate || {};
  const sens = c.sensitivity_level || "UNKNOWN";
  return `<div class="card">
    <div class="headline">${esc(s.headline || `Story ${group.story_id}`)}</div>
    <div class="meta">
      <span>${esc(s.category_id || "—")}</span>
      <span>geo: ${esc(group.audience_geo)}</span>
      <span>score ${esc(s.story_score ?? "—")}</span>
      <span>conf ${esc(s.confidence_score ?? "—")}</span>
      <span>rel ${esc(c.relevance_score ?? "—")}</span>
      <span class="sens-${esc(sens)}">${esc(sens)}</span>
    </div>
    ${s.summary ? `<div class="summary">${esc(s.summary)}</div>` : ""}
    ${["x", "facebook", "instagram"].map((p) => group.byPlatform[p]).filter(Boolean)
      .map((post) => renderPlatform(post, actionable)).join("")}
  </div>`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post("/login", (req, res) => {
  if (!tokenMatches(req.body.token)) return res.status(401).send(loginPage("Invalid token."));
  res.cookie(COOKIE, req.body.token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 3600 * 1000 });
  res.redirect(BASE);
});

router.post("/logout", (req, res) => {
  res.clearCookie(COOKIE);
  res.redirect(BASE);
});

router.get("/", requireAdmin, async (req, res) => {
  const supabase = buildSupabase();

  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, story_id, candidate_id, platform, audience_geo, post_text, media_url, status, platform_post_id, error_message, updated_at")
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).send(page("Error", `<p class="err">${esc(error.message)}</p>`));

  // Hydrate story + candidate meta.
  const storyIds = [...new Set(posts.map((p) => p.story_id))];
  const candIds = [...new Set(posts.map((p) => p.candidate_id).filter(Boolean))];

  const [{ data: stories }, { data: cands }] = await Promise.all([
    storyIds.length
      ? supabase.from("stories").select("id, headline, summary, category_id, story_score, confidence_score, source_count").in("id", storyIds)
      : Promise.resolve({ data: [] }),
    candIds.length
      ? supabase.from("social_publication_candidates").select("id, sensitivity_level, relevance_score").in("id", candIds)
      : Promise.resolve({ data: [] }),
  ]);

  const storyById = new Map((stories || []).map((s) => [s.id, s]));
  const candById = new Map((cands || []).map((c) => [c.id, c]));

  // Group posts by (story_id, audience_geo) within each section.
  function groupsFor(statuses) {
    const groups = new Map();
    for (const post of posts) {
      if (!statuses.includes(post.status)) continue;
      const key = `${post.story_id}::${post.audience_geo}`;
      if (!groups.has(key)) {
        groups.set(key, {
          story_id: post.story_id,
          audience_geo: post.audience_geo,
          story: storyById.get(post.story_id),
          candidate: candById.get(post.candidate_id),
          byPlatform: {},
        });
      }
      groups.get(key).byPlatform[post.platform] = post;
    }
    return [...groups.values()];
  }

  const sectionsHtml = SECTIONS.map((sec) => {
    const groups = groupsFor(sec.statuses);
    const body = groups.length
      ? groups.map((g) => renderCard(g, sec.actionable)).join("")
      : `<p class="empty">None.</p>`;
    return `<h2>${esc(sec.title)} (${groups.length})</h2>${body}`;
  }).join("");

  res.send(page("Review", sectionsHtml));
});

// ── Status-transition actions ─────────────────────────────────────────────────

const TRANSITIONS = {
  approve: { from: ["PENDING_REVIEW"], set: () => ({ status: "APPROVED" }) },
  "publish-now": { from: ["PENDING_REVIEW", "APPROVED"], set: () => ({ status: "APPROVED", scheduled_for: new Date().toISOString() }) },
  reject: { from: ["PENDING_REVIEW", "APPROVED", "SCHEDULED"], set: () => ({ status: "REJECTED" }) },
};

for (const [action, rule] of Object.entries(TRANSITIONS)) {
  router.post(`/posts/:id/${action}`, requireAdmin, async (req, res) => {
    const supabase = buildSupabase();
    const { data: post, error } = await supabase
      .from("social_posts").select("id, status").eq("id", req.params.id).maybeSingle();
    if (error) return res.status(500).send(page("Error", `<p class="err">${esc(error.message)}</p>`));
    if (!post) return res.status(404).send(page("Not found", `<p class="err">Post not found.</p>`));
    if (!rule.from.includes(post.status)) {
      return res.status(409).send(page("Conflict", `<p class="err">Cannot ${esc(action)} a ${esc(post.status)} post.</p><p><a href="${BASE}">Back</a></p>`));
    }
    const { error: updErr } = await supabase
      .from("social_posts")
      .update({ ...rule.set(), updated_at: new Date().toISOString() })
      .eq("id", req.params.id);
    if (updErr) return res.status(500).send(page("Error", `<p class="err">${esc(updErr.message)}</p>`));
    res.redirect(BASE);
  });
}

// Edit post text (only while still PENDING_REVIEW).
router.post("/posts/:id/edit", requireAdmin, async (req, res) => {
  const text = String(req.body.post_text ?? "").trim();
  if (!text) return res.status(400).send(page("Error", `<p class="err">Post text cannot be empty.</p><p><a href="${BASE}">Back</a></p>`));
  const supabase = buildSupabase();
  const { data: post } = await supabase.from("social_posts").select("status").eq("id", req.params.id).maybeSingle();
  if (!post) return res.status(404).send(page("Not found", `<p class="err">Post not found.</p>`));
  if (post.status !== "PENDING_REVIEW") {
    return res.status(409).send(page("Conflict", `<p class="err">Only pending posts can be edited.</p><p><a href="${BASE}">Back</a></p>`));
  }
  const { error } = await supabase
    .from("social_posts")
    .update({ post_text: text, updated_at: new Date().toISOString() })
    .eq("id", req.params.id);
  if (error) return res.status(500).send(page("Error", `<p class="err">${esc(error.message)}</p>`));
  res.redirect(BASE);
});

export default router;

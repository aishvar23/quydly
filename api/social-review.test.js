// Tests for the public Approve/Reject review endpoint (api/social-review.js).
// Run: node --test api/social-review.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const SECRET = "test-secret";
process.env.SOCIAL_REVIEW_SECRET = SECRET; // core reads from process.env

const { core } = await import("./social-review.js");

const tok = (post, action) => createHmac("sha256", SECRET).update(`${post}:${action}`).digest("hex");

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: "",
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s || ""; },
  };
}

// Minimal chainable Supabase double. Each from() yields a fresh query; the update
// chain is awaited (thenable), the lookups resolve via maybeSingle().
function mockSupabase(state) {
  return {
    from() {
      const q = { _eq: {}, _update: null };
      q.select = () => q;
      q.update = (p) => { q._update = p; return q; };
      q.eq = (k, v) => { q._eq[k] = v; return q; };
      q.maybeSingle = async () => {
        const row = state.rows.find((r) => r.id === q._eq.id) || null;
        return { data: row ? { status: row.status, stories: { headline: row.headline } } : null, error: null };
      };
      q.then = (resolve, reject) => {
        const matched = state.rows.filter((r) => r.id === q._eq.id && (q._eq.status === undefined || r.status === q._eq.status));
        if (q._update) matched.forEach((r) => Object.assign(r, q._update));
        return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
      };
      return q;
    },
  };
}

test("GET with a valid token renders the confirm page and does NOT mutate", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW", headline: "Big news" }] };
  const res = mockRes();
  await core({ method: "GET", query: { post: "p1", action: "approve", token: tok("p1", "approve") } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Approve/);
  assert.match(res.body, /Big news/);          // headline shown for context
  assert.match(res.body, /method="POST"/);     // action deferred to POST
  assert.equal(state.rows[0].status, "PENDING_REVIEW"); // GET never changed it
});

test("POST approve flips PENDING_REVIEW → APPROVED", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", token: tok("p1", "approve") } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Approved/);
  assert.equal(state.rows[0].status, "APPROVED");
});

test("POST reject flips PENDING_REVIEW → REJECTED", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "reject", token: tok("p1", "reject") } }, res, mockSupabase(state));
  assert.equal(state.rows[0].status, "REJECTED");
  assert.match(res.body, /Rejected/);
});

test("an invalid token is rejected (403) and never mutates", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", token: "deadbeef" } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 403);
  assert.equal(state.rows[0].status, "PENDING_REVIEW");
});

test("a token signed for a DIFFERENT action does not authorise this action", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const res = mockRes();
  // reject-signed token used on the approve link → invalid
  await core({ method: "POST", query: { post: "p1", action: "approve", token: tok("p1", "reject") } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 403);
  assert.equal(state.rows[0].status, "PENDING_REVIEW");
});

test("POST on an already-decided post is a no-op ('Already handled')", async () => {
  const state = { rows: [{ id: "p1", status: "POSTED" }] };
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", token: tok("p1", "approve") } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Already handled/);
  assert.match(res.body, /POSTED/);
  assert.equal(state.rows[0].status, "POSTED"); // unchanged
});

test("a malformed link (missing action) → 400", async () => {
  const res = mockRes();
  await core({ method: "GET", query: { post: "p1", token: "x" } }, res, mockSupabase({ rows: [] }));
  assert.equal(res.statusCode, 400);
});

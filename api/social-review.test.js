// Tests for the public Approve/Reject review endpoint (api/social-review.js).
// Run: node --test api/social-review.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

const SECRET = "test-secret";
process.env.SOCIAL_REVIEW_SECRET = SECRET; // core reads from process.env

const { core } = await import("./social-review.js");
const { reviewTokenSig } = await import("../azure-functions/lib/social/review-token.js");

const future = () => Date.now() + 60 * 60 * 1000; // +1h
const past = () => Date.now() - 1000;             // expired
const tok = (post, action, exp) => reviewTokenSig(post, action, exp, SECRET);

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
  const exp = future();
  const res = mockRes();
  await core({ method: "GET", query: { post: "p1", action: "approve", exp, token: tok("p1", "approve", exp) } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Approve/);
  assert.match(res.body, /Big news/);          // headline shown for context
  assert.match(res.body, /method="POST"/);     // action deferred to POST
  assert.match(res.body, new RegExp(`exp=${exp}`)); // exp carried into the POST form
  assert.equal(state.rows[0].status, "PENDING_REVIEW"); // GET never changed it
});

test("GET escapes a headline containing HTML (no injection / no broken page)", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW", headline: 'A<img src=x onerror=alert(1)> & "B"' }] };
  const exp = future();
  const res = mockRes();
  await core({ method: "GET", query: { post: "p1", action: "approve", exp, token: tok("p1", "approve", exp) } }, res, mockSupabase(state));
  assert.ok(!res.body.includes("<img src=x"), "raw markup must not appear");
  assert.match(res.body, /&lt;img src=x/);     // escaped
  assert.match(res.body, /&amp;/);             // & escaped
});

test("POST approve flips PENDING_REVIEW → APPROVED", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const exp = future();
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", exp, token: tok("p1", "approve", exp) } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Approved/);
  assert.equal(state.rows[0].status, "APPROVED");
});

test("POST reject flips PENDING_REVIEW → REJECTED", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const exp = future();
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "reject", exp, token: tok("p1", "reject", exp) } }, res, mockSupabase(state));
  assert.equal(state.rows[0].status, "REJECTED");
  assert.match(res.body, /Rejected/);
});

test("an invalid token is rejected (403) and never mutates", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", exp: future(), token: "deadbeef" } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 403);
  assert.equal(state.rows[0].status, "PENDING_REVIEW");
});

test("an EXPIRED token is rejected (403) even though the HMAC is otherwise correct", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const exp = past();
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", exp, token: tok("p1", "approve", exp) } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 403);
  assert.equal(state.rows[0].status, "PENDING_REVIEW");
});

test("a token bound to a DIFFERENT action/exp does not authorise this request", async () => {
  const state = { rows: [{ id: "p1", status: "PENDING_REVIEW" }] };
  const exp = future();
  const res = mockRes();
  // reject-signed token replayed on the approve link → invalid
  await core({ method: "POST", query: { post: "p1", action: "approve", exp, token: tok("p1", "reject", exp) } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 403);
  // exp tampered (different value than was signed) → invalid
  const res2 = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", exp: future() + 1, token: tok("p1", "approve", exp) } }, res2, mockSupabase(state));
  assert.equal(res2.statusCode, 403);
  assert.equal(state.rows[0].status, "PENDING_REVIEW");
});

test("POST on an already-decided post is a no-op ('Already handled'), no second query", async () => {
  const state = { rows: [{ id: "p1", status: "POSTED" }] };
  const exp = future();
  const res = mockRes();
  await core({ method: "POST", query: { post: "p1", action: "approve", exp, token: tok("p1", "approve", exp) } }, res, mockSupabase(state));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Already handled/);
  assert.equal(state.rows[0].status, "POSTED"); // unchanged
});

test("a malformed link (missing action) → 400", async () => {
  const res = mockRes();
  await core({ method: "GET", query: { post: "p1", token: "x" } }, res, mockSupabase({ rows: [] }));
  assert.equal(res.statusCode, 400);
});

# Implementation Tracker: Social Distribution Pipeline

**Design doc:** [`social-distribution-pipeline-design.md`](./social-distribution-pipeline-design.md)
**Branch:** `feature/social-distribution-pipeline-impl` (docs already merged to `main` from `feature/social-distribution-pipeline`)
**Status:** In progress — Phases 0–5 ☑ (MVP core complete; X live-verified, real tweet `2060851089344205142` posted to @quydlynews; auto-publish gated OFF by default) · remaining: 4.7 Facebook publish + post-MVP items (L1–L9)
**Owner:** Aishvarya Suhane

> One canonical story. Many platform-native assets. The social layer is added *after*
> `stories` + `story_audiences` and must not touch ingestion, clustering, or synthesis.

---

## How to use this tracker

- Work phase by phase (0 → 5). Do not start a phase until the previous one's exit criteria pass.
- Update the **Status** column as you go: ☐ Todo · ◐ In progress · ☑ Done · ⊘ Blocked.
- Each task lists its acceptance check. A task is only ☑ when the check passes and `npm run lint` is clean.
- Tick the MVP Acceptance Criteria (bottom) only when end-to-end verified.

---

## ⚠️ Resolve before coding (design vs. repo reality)

The design doc's "Files to Add" section assumes a layout that does **not** match this repo. Confirm the intended paths with the owner first.

| # | Design doc assumes | Actual repo | Decision needed |
|---|---|---|---|
| D1 | `azure-functions/functions/*.js` (flat files) | Folder-per-function: `azure-functions/discover/`, `article-scraper/`, etc. each with `function.json` | Use folder-per-function: `azure-functions/social-candidate-selector/`, `social-post-generator/`, `social-publisher/` |
| D2 | `azure-functions/lib/social/...` shared utils | `azure-functions/lib/` is the canonical shared-utils home (authoritative, no backend copy) | ✅ Matches — put shared code under `azure-functions/lib/social/` |
| D3 | `app/admin/social/page.js` (Next.js App Router) | Stack is React Native (Expo) frontend + Express backend. No Next.js `app/` dir. | ✅ **RESOLVED (owner):** option (a) — Express server-rendered page + actions under `backend/routes/adminSocial.js`. |
| D6 | `story_id uuid references stories(id)` | `stories.id` is `bigserial` (bigint); `story_audiences.story_id` is bigint | ✅ **RESOLVED:** all `story_id` FKs use `bigint`. Social tables keep `uuid` surrogate PKs. |
| D7 | story has `category` col; selector filters `s.created_at >= now()-36h` | story has `category_id` (text), no `created_at` — only `published_at` | ✅ **RESOLVED:** candidate `category` ← `category_id`; freshness window uses `published_at`. |
| D4 | Service Bus `social-post-generate-queue` | Existing queues: `scrape-queue`, `synthesize-queue` (ServiceBus) | Provision new `social-post-generate-queue` in same namespace |
| D5 | AI model unspecified for post gen | `backend/services/claude.js` uses `claude-sonnet-4-20250514` | Reuse Claude client + same model for post generation |

---

## Phase 0 — Schema Only (no publishing)

Goal: all three tables exist; nothing runs yet.

| # | Task | File(s) | Status | Acceptance check |
|---|---|---|---|---|
| 0.1 | Create migration adding `social_publication_candidates` | `backend/db/migration_social_distribution.sql` (mirror `migration_geo_pipeline.sql` convention) | ☑ | Table + `unique(story_id, audience_geo)` + status/sensitivity defaults present |
| 0.2 | Add `social_posts` table | same migration | ☑ | Table + `unique(story_id, platform, audience_geo)` present |
| 0.3 | Add `social_media_assets` table | same migration | ☑ | Table with `asset_type`, `asset_url`, generation metadata |
| 0.4 | Add helpful indexes | same migration | ☑ | Index on `social_posts(status, scheduled_for)`; `social_publication_candidates(status)`; `*(story_id, audience_geo)` |
| 0.5 | Document status enums as CHECK constraints or comments | same migration | ☑ | All status/sensitivity/platform/asset_type enums enforced via CHECK |
| 0.6 | Apply migration to Supabase (dev) | — | ☑ | Applied via Supabase MCP (`social_distribution_phase0`); 3 tables verified, 0 rows |

**Phase 0 exit:** migration applied, tables queryable, no behavior change to existing pipeline.

---

## Phase 1 — Candidate Selection

Goal: candidate rows created from high-quality stories; no post text yet.

| # | Task | File(s) | Status | Acceptance check |
|---|---|---|---|---|
| 1.1 | Shared candidate logic (query, dedupe, insert) | `azure-functions/lib/social/social-candidates.js` | ☑ | `selectEligibleStories`, `insertCandidate`, `buildPublishReason` (+ pure `buildEligiblePairs`); unit-tested |
| 1.2 | Sensitivity classifier | `azure-functions/lib/social/social-safety.js` | ☑ | `classifySensitivity(story)` → LOW/MEDIUM/HIGH/UNKNOWN; word-boundary + inflection matching; unit-tested |
| 1.3 | Scoring thresholds added to pipeline flags | `azure-functions/lib/flags.js` | ☑ | `FLAGS.social.*` (score≥25, conf≥7, rel≥20, max/day/geo=10) — pipeline flags file only |
| 1.4 | Timer function `social-candidate-selector` | `azure-functions/social-candidate-selector/{index.js,function.json}` | ☑ | TimerTrigger `0 */60 * * * *`; reads stories+story_audiences (read path verified live) |
| 1.5 | Enqueue generation messages | uses `lib/clients.js` ServiceBus | ☑ | One msg/candidate to `social-post-generate-queue`; 10 messages confirmed on queue |
| 1.6 | Per-geo selection (global vs india) | in 1.1 | ☑ | Respects `audience_geo` + per-day cap; unit-tested |

**Phase 1 exit:** ☑ Live run created **10 candidate rows** (all `PENDING`/`global`) + **10 queue messages**; re-run created 0 (idempotent via `UNIQUE(story_id,audience_geo)` + daily cap → `social_candidates_none`). No post text generated, no external social API calls.
**Verification:** `node --test test/social-candidates.test.js` (9 pass) · `node test/verify-social-candidates.js` (read-only) · `node test/run-social-candidate-selector.js` (live).

---

## Phase 2 — Draft Generation

Goal: X / Facebook / Instagram drafts generated, all `PENDING_REVIEW`, no external API calls.

| # | Task | File(s) | Status | Acceptance check |
|---|---|---|---|---|
| 2.1 | Platform formatters | `azure-functions/lib/social/platforms/{x,facebook,instagram}.js` (+ `_shared.js`) | ☑ | `format()` + `buildPrompt()` honoring §8 templates; X reserves CTA space; unit-tested |
| 2.2 | Generator orchestrator | `azure-functions/lib/social/social-post-generator.js` | ☑ | `generateSocialPosts({supabase,anthropic,candidateId})` loops platforms, idempotent upsert |
| 2.3 | Text validation | `azure-functions/lib/social/social-validation.js` | ☑ | §10.4: length, CTA, no "breaking", no unsupported numbers/sources (list ordinals exempt) |
| 2.4 | Claude integration for drafts | `lib/clients.js` `getAnthropic()` | ☑ | `claude-sonnet-4-20250514`; deterministic-first, LLM copy used only if it passes validation |
| 2.5 | ServiceBus function `social-post-generator` | `azure-functions/social-post-generator/{index.js,function.json}` | ☑ | Trigger on `social-post-generate-queue` (binding mirrors `article-scraper`) |
| 2.6 | Idempotent inserts | in 2.2 | ☑ | Skips existing `story_id+platform+audience_geo`; candidate → `POST_GENERATED` |
| 2.7 | Instagram asset placeholder | `requiresMedia` flag + `media_url=null` | ☑ | IG drafts carry no media; publish gate (Phase 4) enforces media-before-publish. Real cards = Phase 6/L1 |

**Phase 2 exit:** ☑ Live run generated **30 drafts** (10×x/fb/ig) all `PENDING_REVIEW` via the real queue path; re-drive idempotent (0 created / 30 skipped); 0 missing CTA, 0 over-length, 0 IG with media; no external social API calls (Claude used for copy only).
**Verification:** `node --test test/social-post-generator.test.js` (8 pass) · `node test/run-social-post-generator.js` (live, enqueue→drain→purge-DLQ).
**Note:** an early runner bug (`logger.log` vs callable `context.log`) dead-lettered the first batch; fixed (callable-logger convention), messages re-driven, DLQ purged. Queue clean (0 active / 0 dead-letter).

---

## Phase 3 — Admin Review

Goal: human can approve / reject / edit posts. (Host TBD — see D3.)

| # | Task | File(s) | Status | Acceptance check |
|---|---|---|---|---|
| 3.1 | Decide admin host | — | ☑ | D3 → Express server-rendered route (owner-confirmed) |
| 3.2 | Admin route/page `/admin/social` | `backend/routes/adminSocial.js` (mounted in `backend/index.js`) | ☑ | 5 sections: Pending / Approved-Scheduled / Posted / Failed / Rejected (§11.1) |
| 3.3 | Post card component | `renderCard` in `adminSocial.js` | ☑ | Shows story meta (headline/category/geo/scores/sensitivity) + 3 platform drafts (§11.2) |
| 3.4 | Actions: approve / reject / edit-text / publish-now | `adminSocial.js` POST routes | ☑ | §11.4 actions; status transitions persisted w/ from-state guards (409 on invalid) |
| 3.5 | Auth/guard on admin route | `requireAdmin` | ☑ | Shared `ADMIN_TOKEN` → httpOnly cookie (timing-safe compare); login/logout |

**Phase 3 exit:** ☑ Verified live against dev DB — auth gate (401 unauth/bad token), login sets cookie, dashboard listed all 10 cards / 30 drafts under Pending Review; approve→Approved, reject→Rejected, edit persisted `post_text`, re-approve blocked (409). Dataset reset to 30 `PENDING_REVIEW` after testing.
**Verification:** `node backend/scripts/verify-admin-social.js` (isolated harness) + curl. **Auth host choice:** Express (D3 option a). **New env var:** `ADMIN_TOKEN` (see X3).

---

## Phase 4 — Manual Publish

Goal: approved posts publish to platform (start with **X only** per recommended MVP scope).

| # | Task | File(s) | Status | Acceptance check |
|---|---|---|---|---|
| 4.1 | X publisher client | `azure-functions/lib/social/platforms/x.js` `publish()` | ☑ | X API v2 `POST /2/tweets`, **OAuth 1.0a User Context** (`lib/social/x-oauth1.js`); returns `{platformPostId, rawResponse}`; signing verified vs X's canonical base string |
| 4.2 | Publishing worker | `azure-functions/social-publisher/{index.js,function.json}` | ☑ | Timer `0 */15 * * * *`; batch ≤20; due APPROVED/SCHEDULED |
| 4.3 | Publish idempotency | `lib/social/social-publisher.js` | ☑ | Conditional claim APPROVED/SCHEDULED+`platform_post_id IS NULL` → `PUBLISHING` before API call (§12.3) |
| 4.4 | Success/failure persistence | in 4.3 | ☑ | Success: `platform_post_id`+`platform_response`+`published_at`; failure: `error_message`+`failed_at` |
| 4.5 | Env vars wired | function app settings | ☑ | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (OAuth 1.0a — matches design doc) + `SOCIAL_MAX_X_POSTS_PER_DAY` set in `local.settings.json`. App permissions = Read+Write (`x-access-level: read-write` confirmed on responses) |
| 4.6 | Failures visible in admin | Phase 3 UI | ☑ | Failed section renders `error_message` (already in `adminSocial.js`) |
| 4.7 | Facebook publisher | `platforms/facebook.js` | ☐ | Deferred (X publish path live-verified) |

**Phase 4 exit:** ☑ **LIVE-VERIFIED (full chain).** After the owner verified the @quydlynews account, the publisher posted a real **276-char** Quydly draft (Argentina World Cup squad) to @quydlynews via OAuth 1.0a `POST /2/tweets` → 201, tweet id `2060851089344205142`, status `POSTED` with `platform_post_id`+`published_at` stored. Confirmed: publisher `social_published` log, DB `POSTED` row, and `GET /2/tweets/{id}` → 200 returning the exact 276-char text. Full chain proven: candidate → draft → admin approve → publisher → live tweet; `DELETE /2/tweets` also exercised live earlier.
**403 root cause (resolved):** X caps **non-verified** accounts at ~140 chars for API posts → the generic `403 {"detail":"You are not permitted to perform this action."}` on the 240–280-char drafts (headers ruled out scope/rate-limit: `x-access-level: read-write`, `x-rate-limit-remaining: 99`). Account verification lifted the cap; the existing 280-char formatter posts unchanged.
**Earlier dead ends (ruled out):** 402 = pay-per-use account had no credits (fixed by loading ~$25); the "duplicate-content" theory was wrong — the real cause was the non-verified 140-char limit.
**Auth = OAuth 1.0a User Context** (single app-owned account — no browser flow, non-expiring portal tokens; chosen over OAuth2 PKCE after reviewing X auth docs).
**Verification:** `node --test test/x-oauth1.test.js test/social-publisher.test.js` (9 pass; base string matches X's published canonical example verbatim). Live: short post 201 + timeline-confirmed + deleted.

---

## Phase 5 — Limited Auto-Publish (gated)

Goal: auto-publish only safe science/tech stories. **Off by default.**

| # | Task | File(s) | Status | Acceptance check |
|---|---|---|---|---|
| 5.1 | Auto-approval gate | `social-safety.js` `evaluateAutoApproval` | ☑ | §10.3: LOW + conf≥8 + score≥30 + ≥3 unique domains + safe category; returns `{eligible, reasons}`; `countSourceDomains` helper; unit-tested |
| 5.2 | Per-day auto-publish cap | `flags.js` + selector | ☑ | `SOCIAL_AUTO_PUBLISH_ENABLED` (env, default OFF) + `autoApprove.maxPerDay=3`; selector counts today's `AUTO_APPROVED`, decrements per approval |
| 5.3 | Sensitive-category hard block | `social-safety.js` | ☑ | `evaluateAutoApproval` requires `classifySensitivity==LOW`; war/crime/death/etc. never eligible (tested even at score 80/conf 10) |
| 5.4 | Auto status path | `social-candidates.js` `decideCandidateStatus` + generator | ☑ | Eligible → `AUTO_APPROVED`; generator sets X/FB drafts `APPROVED` (publisher posts), IG stays `PENDING_REVIEW` (needs media); candidate kept `AUTO_APPROVED` for the daily cap |

**Phase 5 exit:** ☑ With `SOCIAL_AUTO_PUBLISH_ENABLED=true`, only stories clearing the §10.3 gate auto-publish (X/FB) within `maxPerDay`; sensitive/low-quality still require review. **OFF by default** — unset flag means every candidate is `PENDING` (current behaviour unchanged).
**Verification:** full social suite **40 pass** (`social-candidates`, `social-post-generator`, `social-publisher`, `x-oauth1`, `social-autopublish`), `eslint .` clean. Live read-only dry run (`node test/verify-social-autopublish.js`): flag OFF, 18 stories scanned (LOW 1 / UNKNOWN 12 / HIGH 4 / MEDIUM 1), **0 auto-eligible**; no writes, nothing posted.
**X URL-weighting fix (Phase 4 follow-up — ✅ commit `8cf77ae`):** first live tweet dropped its `quydly.com` CTA because X weights each URL as ~23 chars (t.co) → a draft ≤280 *raw* can exceed 280 *weighted* and X strips the trailing URL. Fixed: `weightedLength()` budgets the X formatter; `social-validation.js` measures X by weighted length. Regression-tested. (The already-live tweet still lacks the CTA — cosmetic, left as-is.)

---

## Later (post-MVP, tracked but not scheduled)

| # | Item | Notes |
|---|---|---|
| L1 | Instagram visual text-cards (Phase 6) | 1080×1080 square card, no AI fake scenes; admin preview |
| L2 | Instagram publishing | requires media asset (§ acceptance #16) |
| L3 | Scheduling action (v1.1) | `scheduled_for` already in schema |
| L4 | Carousel slides | headline / what happened / why it matters / CTA |
| L5 | Observability metrics + alerts | §13 metrics, failure-rate / no-output alerts |
| L6 | Extended retry statuses | `FAILED_VALIDATION`, `RATE_LIMITED`, `NEEDS_MANUAL_CHECK` |
| L7 | Additional platforms | LinkedIn, Threads, Telegram, etc. |
| L8 | Social analytics + feedback loop | engagement → ranking weight |
| L9 | Story-to-video | explicitly out of MVP |

---

## Cross-cutting / setup

| # | Task | Status | Notes |
|---|---|---|---|
| X1 | Create branch `feature/social-distribution-pipeline` | ☐ | |
| X2 | Provision `social-post-generate-queue` (ServiceBus) | ☑ | Created in `quydly-pipeline` ns (rg `quydly-pipeline-rg`); lock PT5M, max-delivery 3, TTL 2d (mirrors `synthesize-queue`) |
| X3 | Add all env vars (design "Environment Variables") | ◐ | `ADMIN_TOKEN` (Phase 3) required in backend env. X/FB/IG keys + `SOCIAL_*` caps still pending (Phase 4). Never hardcode keys. |
| X4 | Confirm `host.json` concurrency fits new triggers | ☐ | `autoComplete:false`, `maxConcurrentCalls:8` |
| X5 | Lint clean per phase | ☐ | `npm run lint` before marking any task done |

---

## MVP Acceptance Criteria (verify end-to-end before declaring MVP done)

From design doc §"MVP Acceptance Criteria":

- [x] 1. Candidate selector creates rows for eligible stories
- [x] 2. No duplicate candidates for same `story_id + audience_geo`
- [x] 3. Post generator creates one draft per platform
- [x] 4. No duplicate posts for same `story_id + platform + audience_geo`
- [x] 5. All generated posts start as `PENDING_REVIEW`
- [x] 6. Admin UI lists pending posts
- [x] 7. Admin can approve a post
- [x] 8. Admin can reject a post
- [x] 9. Admin can edit post text before approval
- [x] 10. Publisher only publishes approved posts
- [x] 11. Publisher stores `platform_post_id` after success
- [x] 12. Publisher stores API error details after failure
- [x] 13. Sensitive stories are never auto-approved
- [x] 14. Auto-publish is disabled by default
- [x] 15. No external social API call during candidate selection or draft generation
- [x] 16. Instagram posts require a media asset before publishing
- [x] 17. X posts satisfy length limits
- [x] 18. Facebook posts include a Quydly CTA
- [x] 19. Failed posts are visible in admin UI
- [x] 20. Same story cannot be posted twice to same platform + geo

---

## Recommended build order (from design doc)

1. Schema → 2. Candidate selector → 3. Post generator → 4. Admin review → 5. Manual X publishing
then: 6. Facebook → 7. Instagram text-card gen → 8. Instagram publishing → 9. Limited auto-publish.

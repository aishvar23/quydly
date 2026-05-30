# Design Document: Social Distribution Pipeline

**Feature:** Automatically generate and optionally publish social media posts from synthesized Quydly stories  
**Branch:** `feature/social-distribution-pipeline`  
**Status:** Design v1 — implementation-ready draft  
**Authors:** Aishvarya Suhane

---

## Table of Contents

1. Problem Statement
2. Goals and Non-Goals
3. Core Principle
4. Current Pipeline Context
5. Proposed Architecture
6. Data Model
7. Component Design
8. Platform-Specific Generation
9. Publishing Workflow
10. Safety and Moderation Gates
11. Admin Review UI
12. Idempotency and Retry Model
13. Observability
14. Rollout Plan
15. Risks and Mitigations
16. Future Extensions

---

## 1. Problem Statement

Quydly currently synthesizes high-quality, multi-source news stories that are primarily used to power the quiz experience. This creates a strong daily content asset, but the product has limited distribution surface area.

The quiz app is one consumption mode. The same synthesized stories can also be converted into platform-native social content for X, Facebook, and Instagram.

Today, there is no pipeline for:

- Selecting which synthesized stories are worth publishing socially.
- Generating platform-specific post drafts.
- Creating Instagram-friendly visual cards.
- Reviewing or approving sensitive content before publication.
- Publishing to social platforms safely and idempotently.
- Tracking what was posted, where, when, and with what result.

Without a social distribution layer, Quydly misses the opportunity to use its story synthesis engine as a growth channel.

---

## 2. Goals and Non-Goals

### Goals

1. Generate social media post drafts from synthesized Quydly stories.
2. Support X, Facebook, and Instagram as distribution targets.
3. Reuse the existing canonical `stories` and `story_audiences` outputs.
4. Avoid duplicating ingestion, clustering, or synthesis per platform.
5. Add strict safety gates before auto-publishing.
6. Start with human-reviewed drafts, then gradually allow auto-publishing for low-risk stories.
7. Maintain idempotency so the same story is not accidentally posted multiple times.
8. Store platform responses and post IDs for auditability.
9. Keep the design simple enough for a two-person team to implement and operate.

### Non-Goals

1. No automated video generation in MVP.
2. No YouTube Shorts, TikTok, or Reels publishing in MVP.
3. No per-user personalized social feeds.
4. No separate story synthesis per social platform.
5. No direct publishing of every synthesized story.
6. No fully autonomous publishing for sensitive categories in MVP.
7. No paid social ads or campaign optimization in MVP.
8. No complex social analytics dashboard in MVP.

---

## 3. Core Principle

> One canonical story. Many platform-native assets.

The existing Quydly pipeline should continue producing one canonical story per real-world event. Social distribution should not fork or duplicate the truth layer.

The pipeline should work like this:

```text
Ingest → Cluster → Synthesize → Audience Projection
                              ↓
                       Social Distribution
                              ↓
                  X / Facebook / Instagram
```

The `stories` table remains the source of truth. The social layer only decides:

1. Should this story be posted?
2. Which audience should it target?
3. Which platform should it be formatted for?
4. Should it be auto-published or reviewed first?

---

## 4. Current Pipeline Context

Quydly already has the following pipeline shape:

```text
discover
  ↓
scrape-queue
  ↓
article-scraper
  ↓
raw_articles
  ↓
article-clusterer
  ↓
clusters
  ↓
synthesize-queue
  ↓
story-synthesizer
  ↓
stories
  ↓
story_audiences
  ↓
app / quiz
```

The social distribution pipeline should be added after `stories` and `story_audiences`.

It should not modify the existing ingestion, scraping, clustering, or synthesis stages.

---

## 5. Proposed Architecture

### 5.1 High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Existing Quydly Pipeline                                     │
│                                                              │
│ discover → scrape → raw_articles → clusters → stories         │
│                                             ↓                │
│                                      story_audiences          │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Social Candidate Selector                                    │
│                                                              │
│ Selects high-quality stories that are eligible for social     │
│ distribution based on score, confidence, audience relevance,  │
│ category, sensitivity, and freshness.                         │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ social_publication_candidates                                │
│                                                              │
│ One candidate row per story + audience_geo.                  │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Social Post Generator                                        │
│                                                              │
│ Generates platform-native drafts for X, Facebook, and         │
│ Instagram.                                                    │
└───────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ social_posts                                                  │
│                                                              │
│ One row per story + platform + audience_geo.                 │
└───────────────────────────────┬──────────────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌─────────────────────────────┐      ┌─────────────────────────┐
│ Admin Review UI             │      │ Auto-Publish Gate        │
│                             │      │                         │
│ Human approves, rejects,    │      │ Strictly safe stories    │
│ edits, or publishes now.    │      │ can bypass review later. │
└──────────────┬──────────────┘      └────────────┬────────────┘
               │                                  │
               └────────────────┬─────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Social Publisher                                             │
│                                                              │
│ Publishes approved posts to X, Facebook, and Instagram.       │
│ Stores platform post IDs and API responses.                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Data Model

### 6.1 `social_publication_candidates`

A candidate represents the decision that a story may be suitable for social distribution.

```sql
create table if not exists social_publication_candidates (
  id uuid primary key default gen_random_uuid(),

  story_id uuid not null references stories(id) on delete cascade,
  audience_geo text not null,

  publish_reason text,

  story_score numeric not null,
  relevance_score numeric,
  confidence_score numeric,

  category text,
  sensitivity_level text not null default 'UNKNOWN',

  status text not null default 'PENDING',

  selected_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(story_id, audience_geo)
);
```

Allowed `status` values:

```text
PENDING
APPROVED
REJECTED
AUTO_APPROVED
POST_GENERATED
POSTED
FAILED
```

Allowed `sensitivity_level` values:

```text
LOW
MEDIUM
HIGH
UNKNOWN
```

### 6.2 `social_posts`

A social post is a platform-specific rendering of a candidate story.

```sql
create table if not exists social_posts (
  id uuid primary key default gen_random_uuid(),

  story_id uuid not null references stories(id) on delete cascade,
  candidate_id uuid references social_publication_candidates(id) on delete cascade,

  platform text not null,
  audience_geo text not null,

  post_text text not null,
  media_url text,
  link_url text,

  status text not null default 'DRAFT',

  scheduled_for timestamptz,
  published_at timestamptz,
  failed_at timestamptz,

  platform_post_id text,
  platform_response jsonb,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(story_id, platform, audience_geo)
);
```

Allowed `platform` values:

```text
x
facebook
instagram
```

Allowed `status` values:

```text
DRAFT
PENDING_REVIEW
APPROVED
REJECTED
SCHEDULED
PUBLISHING
POSTED
FAILED
SKIPPED
```

### 6.3 `social_media_assets`

Instagram requires visual assets. X and Facebook may optionally use them.

```sql
create table if not exists social_media_assets (
  id uuid primary key default gen_random_uuid(),

  story_id uuid not null references stories(id) on delete cascade,
  social_post_id uuid references social_posts(id) on delete cascade,

  asset_type text not null,
  asset_url text not null,

  width int,
  height int,
  format text,

  generation_prompt text,
  generation_model text,

  status text not null default 'READY',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Allowed `asset_type` values:

```text
instagram_square_card
instagram_vertical_card
instagram_carousel_slide
x_card
facebook_card
```

---

## 7. Component Design

## 7.1 Social Candidate Selector

### Responsibility

Select synthesized stories that are eligible for social distribution.

### Host

Azure Function.

### Trigger

Timer trigger every 1 hour.

Suggested schedule:

```text
0 */60 * * * *
```

### Inputs

- `stories`
- `story_audiences`

### Outputs

- `social_publication_candidates`
- Messages to `social-post-generate-queue`

### Candidate Selection Rules

A story is eligible if:

```text
story_score >= 25
confidence_score >= 7
story is less than 36 hours old
story has not already been selected for the same audience_geo
audience relevance is high enough
story has enough key points
story has source support
```

For geo-specific feeds:

```text
audience_geo = 'global'
  select globally significant stories

audience_geo = 'india'
  select stories with high India relevance from story_audiences
```

### Initial MVP Thresholds

```text
story_score >= 25
confidence_score >= 7
relevance_score >= 20
max candidates per day per geo = 10
```

### Pseudocode

```js
async function selectSocialCandidates() {
  const stories = await db.query(`
    select
      s.id as story_id,
      s.headline,
      s.summary,
      s.category,
      s.story_score,
      s.confidence_score,
      sa.audience_geo,
      sa.relevance_score
    from stories s
    join story_audiences sa on sa.story_id = s.id
    where s.created_at >= now() - interval '36 hours'
      and s.story_score >= 25
      and s.confidence_score >= 7
      and sa.relevance_score >= 20
      and not exists (
        select 1
        from social_publication_candidates c
        where c.story_id = s.id
          and c.audience_geo = sa.audience_geo
      )
    order by sa.audience_geo, sa.relevance_score desc, s.story_score desc
  `);

  for (const story of stories) {
    const sensitivityLevel = classifySensitivity(story);

    const candidate = await insertCandidate({
      storyId: story.story_id,
      audienceGeo: story.audience_geo,
      storyScore: story.story_score,
      relevanceScore: story.relevance_score,
      confidenceScore: story.confidence_score,
      category: story.category,
      sensitivityLevel,
      status: 'PENDING',
      publishReason: buildPublishReason(story)
    });

    await enqueueSocialPostGeneration(candidate.id);
  }
}
```

---

## 7.2 Social Post Generator

### Responsibility

Generate platform-specific social post drafts from a selected candidate.

### Host

Azure Function.

### Trigger

Service Bus trigger:

```text
social-post-generate-queue
```

### Inputs

- Candidate ID
- `social_publication_candidates`
- `stories`
- `story_audiences`

### Outputs

- `social_posts`
- `social_media_assets`, if needed

### Supported Platforms in MVP

```text
x
facebook
instagram
```

### Generation Strategy

The generator should create different content for each platform. It should not reuse the exact same text everywhere.

Each story can produce up to three posts:

```text
story + audience_geo + x
story + audience_geo + facebook
story + audience_geo + instagram
```

Each insert must be idempotent using:

```text
unique(story_id, platform, audience_geo)
```

### Pseudocode

```js
async function generateSocialPosts(candidateId) {
  const candidate = await getCandidate(candidateId);
  const story = await getStory(candidate.story_id);

  if (!candidate || !story) {
    throw new Error(`Missing candidate or story for candidate ${candidateId}`);
  }

  const platforms = ['x', 'facebook', 'instagram'];

  for (const platform of platforms) {
    const existing = await getSocialPost(
      story.id,
      platform,
      candidate.audience_geo
    );

    if (existing) {
      continue;
    }

    const post = await generatePlatformPost({
      story,
      platform,
      audienceGeo: candidate.audience_geo
    });

    await insertSocialPost({
      storyId: story.id,
      candidateId: candidate.id,
      platform,
      audienceGeo: candidate.audience_geo,
      postText: post.text,
      mediaUrl: post.mediaUrl,
      linkUrl: post.linkUrl,
      status: 'PENDING_REVIEW'
    });
  }

  await updateCandidateStatus(candidate.id, 'POST_GENERATED');
}
```

---

## 8. Platform-Specific Generation

## 8.1 X Post Format

### Constraints

- Short, direct, timely.
- Avoid clickbait.
- Include Quydly CTA.
- Prefer one concise post over long threads in MVP.

### Template

```text
{headline}

{one_sentence_summary}

Why it matters:
• {key_point_1}
• {key_point_2}

Take today’s news quiz: {quydly_url}
```

### X Generation Rules

```text
max length: 260 characters when possible
absolute max length: 280 characters
no hashtags in MVP unless category-specific and clearly useful
no source URLs in MVP unless required
no unverified claims
no "breaking" unless the story is truly breaking and recently updated
```

---

## 8.2 Facebook Post Format

### Constraints

- Slightly more explanatory than X.
- Can include link to Quydly.
- Better suited for paragraph + bullets.

### Template

```text
{headline}

{two_sentence_summary}

What to know:
1. {key_point_1}
2. {key_point_2}
3. {key_point_3}

Try the 5-question Quydly news quiz: {quydly_url}
```

### Facebook Generation Rules

```text
max length: 900 characters
avoid sensational wording
include 2–3 key points
include CTA
do not include raw source list in post body
```

---

## 8.3 Instagram Post Format

### Constraints

Instagram is visual-first. The MVP should not publish caption-only story posts.

Each Instagram post should have:

```text
image card or carousel
caption
CTA
```

### MVP Asset Type

Start with a single square card:

```text
1080x1080
```

Later support carousel:

```text
Slide 1: Headline
Slide 2: What happened
Slide 3: Why it matters
Slide 4: Quiz CTA
```

### Instagram Card Layout

```text
Top:
  Quydly logo or wordmark

Main:
  short headline

Middle:
  one visual element or category label

Bottom:
  "Take the quiz at quydly.com"
```

### Instagram Caption Template

```text
{headline}

{short_summary}

What to know:
• {key_point_1}
• {key_point_2}
• {key_point_3}

Can you answer today’s news quiz?
Visit quydly.com
```

### Instagram Generation Rules

```text
caption max length: 1,500 characters
avoid source links in caption
do not use unrelated AI images for real news events
prefer text-card graphics over generated fake scenes
for people, disasters, wars, or crimes, use neutral graphic cards only
```

---

## 9. Publishing Workflow

## 9.1 MVP Workflow

MVP should be review-first.

```text
social_publication_candidates
  ↓
social_posts generated as PENDING_REVIEW
  ↓
admin reviews post
  ↓
admin approves
  ↓
social_posts.status = APPROVED
  ↓
social-publisher publishes
  ↓
status = POSTED
```

## 9.2 Future Auto-Publish Workflow

Only low-risk stories should be auto-published.

```text
candidate selected
  ↓
safety gate passes
  ↓
post generated
  ↓
auto approval gate passes
  ↓
scheduled
  ↓
published
```

## 9.3 Publishing Worker

### Responsibility

Publish approved social posts to the correct platform.

### Host

Azure Function.

### Trigger

Timer trigger every 15 minutes.

Suggested schedule:

```text
0 */15 * * * *
```

### Input

`social_posts` where:

```text
status in ('APPROVED', 'SCHEDULED')
and scheduled_for <= now()
```

### Output

Updated `social_posts` row.

### Pseudocode

```js
async function publishApprovedPosts() {
  const posts = await db.query(`
    select *
    from social_posts
    where status in ('APPROVED', 'SCHEDULED')
      and (scheduled_for is null or scheduled_for <= now())
    order by scheduled_for nulls first, created_at asc
    limit 20
  `);

  for (const post of posts) {
    try {
      await markPublishing(post.id);

      const result = await publishToPlatform(post);

      await markPosted({
        postId: post.id,
        platformPostId: result.platformPostId,
        platformResponse: result.rawResponse
      });
    } catch (error) {
      await markFailed({
        postId: post.id,
        errorMessage: error.message
      });
    }
  }
}
```

---

## 10. Safety and Moderation Gates

Social posting has higher brand risk than quiz generation. The social layer needs stricter controls.

## 10.1 Sensitive Categories

The following categories should require human review in MVP:

```text
war
terrorism
death
crime
sexual assault
child harm
medical advice
financial advice
elections
religion
communal conflict
legal accusations
```

## 10.2 Auto-Reject Conditions

Reject or require manual review if:

```text
headline is unclear
summary contains unsupported claim
confidence_score < 7
story has fewer than 2 sources
story is based on only one low-authority source
story contains graphic violence
story contains allegations against a private person
story contains medical, legal, or financial instructions
story is likely satire or opinion
story is stale
```

## 10.3 Auto-Approval Conditions

Future v2 only.

A post may be auto-approved if:

```text
sensitivity_level = LOW
confidence_score >= 8
story_score >= 30
unique_domains >= 3
category in ('science', 'technology', 'culture', 'sports', 'business')
no tragic event detected
no political persuasion language
post text passes validation
```

## 10.4 Text Validation Rules

Before saving a generated post:

```text
must not invent facts not present in story
must not mention "sources say" unless source support exists
must not include unsupported numbers
must not overstate certainty
must not use "breaking" unless story was updated recently
must not include defamatory phrasing
must include Quydly CTA
must fit platform length limits
```

---

## 11. Admin Review UI

Add an internal admin page:

```text
/admin/social
```

## 11.1 Page Sections

```text
Pending Review
Approved / Scheduled
Posted
Failed
Rejected
```

## 11.2 Pending Review Card

Each card should show:

```text
story headline
story summary
category
audience_geo
story_score
confidence_score
relevance_score
sensitivity_level
source/domain count
generated X post
generated Facebook post
generated Instagram preview
```

## 11.3 Actions

```text
Approve
Reject
Edit Text
Regenerate
Publish Now
Schedule
View Story
View Sources
```

## 11.4 MVP Admin Behavior

For MVP, support:

```text
Approve post
Reject post
Edit post_text
Publish now
```

Scheduling can be v1.1.

---

## 12. Idempotency and Retry Model

## 12.1 Candidate Idempotency

A story should only become one candidate per audience.

Enforced by:

```text
unique(story_id, audience_geo)
```

## 12.2 Post Idempotency

A story should only create one post per platform per audience.

Enforced by:

```text
unique(story_id, platform, audience_geo)
```

## 12.3 Publishing Idempotency

Before publishing, the worker must check:

```text
platform_post_id is null
status is APPROVED or SCHEDULED
```

The worker must mark a post as `PUBLISHING` before calling the platform API.

If the platform API succeeds but the DB update fails, there is still risk of duplicate posting on retry. To reduce this:

1. Store request attempt before API call.
2. Use platform idempotency keys if available.
3. Keep publishing batch small.
4. Alert on uncertain failures.
5. Require manual review for retry when error state is ambiguous.

## 12.4 Retry Rules

```text
generation failure:
  retry up to 3 times

platform rate limit:
  retry with backoff

validation failure:
  mark FAILED_VALIDATION, do not retry automatically

ambiguous publish failure:
  mark NEEDS_MANUAL_CHECK
```

Optional future status values:

```text
FAILED_VALIDATION
RATE_LIMITED
NEEDS_MANUAL_CHECK
```

---

## 13. Observability

## 13.1 Metrics

Track:

```text
social_candidates_created_total
social_candidates_rejected_total
social_posts_generated_total
social_posts_approved_total
social_posts_published_total
social_posts_failed_total
social_posts_by_platform
social_posts_by_audience_geo
social_generation_latency_ms
social_publish_latency_ms
platform_api_errors_total
```

## 13.2 Logs

Every function should log:

```text
candidate_id
story_id
platform
audience_geo
status transition
error_message
platform_post_id
```

## 13.3 Alerts

Create alerts for:

```text
publishing failure rate > 20%
no posts generated in 24 hours
no candidates selected in 24 hours
platform auth failure
rate limit spike
ambiguous publish failure
```

---

## 14. Rollout Plan

## Phase 0: Schema Only

Add tables:

```text
social_publication_candidates
social_posts
social_media_assets
```

No publishing.

## Phase 1: Candidate Selection

Implement `social-candidate-selector`.

Expected output:

```text
candidate rows are created from high-quality stories
no post text generated yet
```

## Phase 2: Draft Generation

Implement `social-post-generator`.

Expected output:

```text
X, Facebook, and Instagram drafts generated
all posts remain PENDING_REVIEW
no external API calls
```

## Phase 3: Admin Review

Implement `/admin/social`.

Expected output:

```text
human can approve, reject, and edit posts
```

## Phase 4: Manual Publish

Implement platform publishing, but only for manually approved posts.

Expected output:

```text
approved posts can be published
platform_post_id stored
failures visible in admin UI
```

## Phase 5: Limited Auto-Publish

Enable auto-publish only for safe categories.

Suggested starting rule:

```text
science and technology only
confidence_score >= 8
story_score >= 30
unique_domains >= 3
sensitivity_level = LOW
max 3 auto-published posts per day
```

## Phase 6: Instagram Visual Cards

Add generated image cards for Instagram.

Expected output:

```text
square cards generated
caption generated
admin can preview before publishing
```

---

## 15. Risks and Mitigations

## 15.1 Risk: Posting Incorrect News

### Mitigation

Use only synthesized stories with strong confidence and multi-source support. Require manual review for sensitive stories.

## 15.2 Risk: Looking Spammy

### Mitigation

Do not publish every synthesized story.

Recommended initial limits:

```text
X: 5–10 posts/day
Facebook: 3–5 posts/day
Instagram: 1–3 posts/day
```

## 15.3 Risk: Platform API Instability

### Mitigation

Store platform responses, retry safely, and avoid marking posts as complete until platform post ID is saved.

## 15.4 Risk: Instagram Asset Quality

### Mitigation

Start with clean text-based cards instead of AI-generated news scenes. Avoid fake images of real events.

## 15.5 Risk: Brand Damage from Sensitive Stories

### Mitigation

Human review required for politics, war, crime, tragedy, religion, and legal accusation stories.

## 15.6 Risk: Too Much Operational Burden

### Mitigation

Start review-first and publish manually. Do not build complex analytics, scheduling, or video generation in MVP.

---

## 16. Future Extensions

## 16.1 Platform Expansion

Future platforms:

```text
LinkedIn
YouTube Shorts
TikTok
Threads
WhatsApp Channels
Telegram Channels
```

## 16.2 Social Analytics

Track:

```text
impressions
likes
shares
comments
clicks
quiz starts from social
quiz completions from social
```

## 16.3 Feedback Loop

Use social performance to improve story ranking.

Example:

```text
high engagement on science stories
  → increase science weight in social candidate selection
```

## 16.4 Story-to-Video

Once text and card posting are stable, add video.

Suggested future pipeline:

```text
story
  ↓
video_script
  ↓
storyboard
  ↓
voiceover
  ↓
visual cards / generated clips
  ↓
short video
  ↓
manual review
  ↓
publish
```

This should not be part of MVP.

## 16.5 Multiple Social Accounts

Possible future account strategy:

```text
@Quydly
@QuydlyIndia
@QuydlyTech
@QuydlyWorld
```

Do not do this until the core pipeline is reliable.

---

# Implementation Notes for Claude

## Files to Add

```text
docs/social-distribution-pipeline-design.md

supabase/migrations/YYYYMMDD_add_social_distribution_tables.sql

azure-functions/functions/social-candidate-selector.js
azure-functions/functions/social-post-generator.js
azure-functions/functions/social-publisher.js

azure-functions/lib/social/platforms/x.js
azure-functions/lib/social/platforms/facebook.js
azure-functions/lib/social/platforms/instagram.js

azure-functions/lib/social/social-post-generator.js
azure-functions/lib/social/social-safety.js
azure-functions/lib/social/social-validation.js
azure-functions/lib/social/social-candidates.js

app/admin/social/page.js
app/admin/social/components/SocialPostCard.jsx
app/admin/social/actions.js
```

## Environment Variables

```text
X_API_KEY
X_API_SECRET
X_ACCESS_TOKEN
X_ACCESS_TOKEN_SECRET

FACEBOOK_PAGE_ID
FACEBOOK_ACCESS_TOKEN

INSTAGRAM_BUSINESS_ACCOUNT_ID
INSTAGRAM_ACCESS_TOKEN

SOCIAL_AUTO_PUBLISH_ENABLED=false
SOCIAL_MAX_X_POSTS_PER_DAY=10
SOCIAL_MAX_FACEBOOK_POSTS_PER_DAY=5
SOCIAL_MAX_INSTAGRAM_POSTS_PER_DAY=3
```

## Service Bus Queues

```text
social-post-generate-queue
```

The publisher can be timer-driven in MVP. A separate publish queue is optional but not required initially.

## MVP Acceptance Criteria

1. Candidate selector creates rows for eligible stories.
2. Candidate selector does not create duplicate candidates for the same `story_id + audience_geo`.
3. Post generator creates one draft per platform.
4. Post generator does not create duplicate posts for the same `story_id + platform + audience_geo`.
5. All generated posts start as `PENDING_REVIEW`.
6. Admin UI lists pending posts.
7. Admin can approve a post.
8. Admin can reject a post.
9. Admin can edit post text before approval.
10. Publisher only publishes approved posts.
11. Publisher stores `platform_post_id` after success.
12. Publisher stores API error details after failure.
13. Sensitive stories are never auto-approved.
14. Auto-publish is disabled by default.
15. No external social API call happens during candidate selection or draft generation.
16. Instagram posts require a media asset before publishing.
17. X posts must satisfy length limits.
18. Facebook posts must include a Quydly CTA.
19. Failed posts are visible in admin UI.
20. The same story cannot be posted twice to the same platform and geo.

---

# Recommended MVP Scope

Build only this first:

```text
1. Schema
2. Candidate selector
3. Post generator
4. Admin review page
5. Manual X publishing
```

Then add:

```text
6. Facebook publishing
7. Instagram text-card generation
8. Instagram publishing
9. Limited auto-publish
```

Do not start with all platforms fully automated. The highest-value MVP is a reviewable social draft engine that turns Quydly stories into publish-ready posts.

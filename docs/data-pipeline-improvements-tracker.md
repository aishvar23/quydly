# Daily News Pipeline — Data Quality Improvements Tracker

> Owner: synthesizer / scraper team
> Consumer: `video-pipeline-v2` and the question generator
> Last updated: 2026-05-04

## Why this exists

The video pipeline (`video-pipeline-v2`) is producing weak narration on real
Supabase stories despite a solid render path. Root cause: the data it
consumes is thin. We saw this concretely on a 10-story batch:

| Gap | Frequency in 10-story batch | Effect on video |
|---|---|---|
| `source_documents` empty | 10/10 | No EvidenceShelf, no attribution chips, no QuoteCard |
| `primary_geos` empty | 7/10 | No MapCallout, no place photo |
| Verbatim quotes absent | 10/10 | QuoteCard module never fires |
| Story-type fallback to `general` | 7/10 | Generic narration, no posture, no specialised fields |
| Named subject recognised | 1/10 | DossierCard typographic-only or skipped |

The synthesizer's job is to deliver stories that already carry the
structured data the video pipeline needs. Today it under-delivers. The
items below close that gap.

## How to use this tracker

Each item has:
- **What**: the change
- **Why**: what video-pipeline gap it closes (with concrete example)
- **Where**: which file/table/function in the upstream codebase
- **Effort**: rough size (S < 2h, M 2-6h, L 6-16h, XL 16+h)
- **Priority**: P0 (blocks core feature) / P1 (significant lift) / P2 (polish)
- **Status**: ☐ not started / ◐ in progress / ☑ done

Knock items off in priority order. Stop and run a 5-story video render
after each P0 item to verify the lift; this is the only honest way to
measure impact.

---

## P0 — Blocks core video features

These items have visible degradation in the current rendered output.
Without them, the video pipeline has nothing to render meaningfully.

### P0-1 ☐ Snapshot source documents on the story row

**What**: Add a `source_documents jsonb` column to `stories`. Populate at
synthesis time with `[{ id, type, title, issuer, url, date, quote_text?,
quote_speaker?, quote_role? }]` extracted from the cluster's articles.

**Why**: `cluster.article_ids` references `raw_articles` which gets
retention-pruned. Today every Supabase story renders with empty
EvidenceShelf because the joined articles are gone. This is the **single
biggest data quality issue** affecting video output.

**Where**: `azure-functions/story-synthesizer/index.js` — at insert time,
join the articles, project the fields, store inline. Migration:
`backend/db/migration_<n>_story_source_documents.sql`.

**Effort**: M (a Supabase migration + 30 lines in synthesizer + a
backfill job for existing rows).

**Video impact**: Restores EvidenceShelf module on every story.
Restores all source-citation chips across DossierCard / NumberCard /
MapCallout / TimelineCard. This alone makes videos look sourced.

---

### P0-2 ☐ Extract verbatim quotes during synthesis

**What**: When Claude synthesises a story, also extract 1-3 verbatim
quotes from the underlying articles. Store as
`source_documents[i].quote_text / quote_speaker / quote_role`. Each quote
must come from one of the articles, not be paraphrased.

**Why**: QuoteCard has rendered exactly **zero times** on Supabase data
because no `quote_text` exists anywhere in the schema. The video pipeline
never invents quotes (by design — paraphrasing real people is a trust
violation), so this beat is permanently silent without source-side
support.

**Where**: `azure-functions/story-synthesizer/index.js` — extend the
synthesis prompt to also output a `verbatim_quotes` array. Validate that
each quote is found verbatim in at least one source article before
storing. Reject quotes that don't pass the verbatim check.

**Effort**: M (prompt update + verification + storage in
source_documents JSON).

**Video impact**: QuoteCard fires on every story with an extractable
quote. Doubles editorial gravitas — verbatim quotes are the hardest
visual currency to fake.

---

### P0-3 ☐ Resolve and store readable place names

**What**: For every story's `primary_geos`, store both the ISO code AND
the readable proper-case name. Schema: `primary_geos jsonb` with shape
`[{ code: "us", name: "Manhattan", admin: "New York", lat, lon }]`. OR
add a parallel `primary_places jsonb` column.

**Why**: Today `primary_geos = ["us"]`. The video pipeline has to
translate via a hand-curated `COUNTRY_CODE_TO_NAME` map and falls back to
Mapbox geocoding for unknowns. Both are best-effort. If the synthesizer
already extracted "Manhattan" from the article text, we lose that detail
when only the country code is stored.

**Where**: `azure-functions/article-clusterer/index.js` and
`story-synthesizer/index.js` — store the rich form alongside the
country-code roll-up. Coords come from a forward-geocode at synthesis
time (one-time cost, then cached forever).

**Effort**: M (schema migration + clusterer/synthesizer updates +
geocoding integration).

**Video impact**: MapCallout fires on every geo-bearing story. Place
photos resolve correctly via Wikipedia (`Manhattan` works; `us` does
not).

---

### P0-4 ☐ Pre-resolve Wikipedia entity coverage

**What**: At synthesis time, for each named person/place in the story,
probe Wikipedia REST API. Store result inline:
`primary_entities: [{ name, type: 'person|place|org', wikipedia_url?,
wikipedia_thumbnail_url?, wikipedia_summary?, image_license?,
resolved: true|false }]`.

**Why**: Today the video pipeline probes Wikipedia at render time, has
to apply a strict title-match safety check (otherwise Trump's
situation-room photo lands on a story about a fictional defendant), and
fails silently when the page doesn't exist. Pre-resolving once at
synthesis means every story carries deterministic image data.

**Where**: New `azure-functions/lib/wikipedia.js` mirroring
`video-pipeline-v2/src/integrations/wikimedia.js` (with the same strict
title-match guard). Synthesizer calls it for each
`primary_entities[i]` and `primary_geos[i]`.

**Effort**: M (port the v2 wikimedia integration into the synthesizer
side + storage).

**Video impact**: DossierCard portraits and MapCallout place photos
resolve at 100% rate where data exists, with attribution baked into the
story row. No render-time API calls needed.

---

### P0-5 ☐ Drop the legacy `general` fallback by expanding type coverage

**What**: 7/10 of the random Supabase stories fell to `general` because
they didn't match `legal_scandal / geopolitics_world / finance_markets /
election_result / natural_disaster / tech_cyber /
culture_entertainment`. The unmatched stories were sports, celebrity-
non-cultural, religion (Pope), tech product launches, and miscellaneous
breaking news. Either:

1. Add story types: `sports`, `religion_society`, `tech_product`,
   `science_health`, `crime_general` (non-indictment).
2. OR have synthesis emit a structured "story_archetype" tag with richer
   fields per archetype.

**Why**: `general` produces flat narration because it lacks specialised
extractors and posture chips. Real-world Supabase content needs
specialised handling.

**Where**: Either v2-side (`src/pipeline/understand/story-types/`) or
synthesizer-side (story_type field becomes more granular). The
synthesizer is the right place if we want types to drive specialised
data extraction at synthesis time (e.g. sports stories pull
score/league/teams, science stories pull paper DOI / authors /
institution).

**Effort**: L (per added type, in either codebase). Probably 5-7 new
types over a quarter.

**Video impact**: Better-typed stories produce better videos. `general`
fallback should be reserved for genuinely uncategorisable news, not for
half the daily output.

---

## P1 — Significant quality lift

### P1-1 ☐ Structured numeric extraction at synthesis

**What**: Synthesizer outputs structured numbers per story instead of
relying on the video pipeline to re-parse free text. Schema:

```jsonb
"structured_numbers": {
  "money": [{ display: "$8 billion", value: 8000000000, role: "alleged take" }],
  "counts": [{ display: "25 years", value: 25, unit: "years", label: "sentence" }],
  "percentages": [{ display: "54.3%", value: 54.3, role: "winner share" }],
  "magnitudes": null,
  "casualties": null
}
```

**Why**: Today the video pipeline runs regex over `summary + key_points`
to extract money / counts / percentages / magnitudes per story type.
Brittle. We've fixed five extraction bugs already (turnout filtering,
diacritic handling, "according to" substring collision, etc.). Doing
this once at synthesis time, with Claude's structured output, eliminates
the regex layer.

**Where**: `azure-functions/story-synthesizer/index.js` — extend
synthesis prompt to emit structured fields. Schema migration on
`stories`.

**Effort**: M (prompt update + migration + careful validation that
extracted values are present in source text).

**Video impact**: Eliminates an entire class of extraction bugs. Frees
the v2 pipeline's per-type extractors to focus on editorial framing,
not parsing.

---

### P1-2 ☐ Per-story `hook_sentence` field

**What**: Synthesizer produces a purpose-built `hook_sentence` (10-18
words, declarative, viewer-led) separate from `headline`. Optimised for
the first 3 seconds of a video, not for an article header.

**Why**: Today the audit step falls back to `headline` when no hook is
provided — but headlines are written for scanability on a feed, not for
spoken delivery. The opening 3 seconds of every video matters most;
giving it a purpose-built sentence is high leverage.

**Where**: `azure-functions/story-synthesizer/index.js` — extend
synthesis prompt. Schema migration.

**Effort**: S (prompt addition + column).

**Video impact**: Stronger hooks = higher hold-through rates on
short-form social. Every video benefits.

---

### P1-3 ☐ Per-story `editorial_posture` enum

**What**: Synthesizer classifies the story's posture from a fixed set:

- `indictment_alleged` — legal scandal, allegations only
- `disclosure_official` — vendor/agency disclosure
- `tally_official` — election result, court ruling
- `policy_decision` — sanctions, treaty, regulatory action
- `disaster_provisional` — natural disaster, casualty figures
- `cultural_moment` — release, sweep, debut
- `breaking_developing` — mid-event, facts still emerging
- `analysis_explainer` — non-event editorial

**Why**: Today the video pipeline's posture chips
(`ALLEGED`, `OFFICIAL TALLY`, `DISCLOSURE STATEMENT`, etc.) are derived
from the story type. Multiple postures can apply to one type, and the
type itself can be ambiguous. Pre-classifying at synthesis lets video
just read the field.

**Where**: `azure-functions/story-synthesizer/index.js` + migration.

**Effort**: S.

**Video impact**: Posture chips are 100% correct, not 80%. No more
"OFFICIAL TALLY" on a story that's really still developing.

---

### P1-4 ☐ Entity-type tags on `primary_entities`

**What**: Today `primary_entities = ["sam bankman-fried", "ftx", "doj",
"lewis kaplan"]` mixes person / org / agency. Replace with a structured
form:

```jsonb
"primary_entities": [
  { "name": "Sam Bankman-Fried", "type": "person", "role": "defendant" },
  { "name": "FTX", "type": "company", "role": "subject" },
  { "name": "Department of Justice", "type": "agency", "role": "prosecutor" },
  { "name": "Lewis A. Kaplan", "type": "person", "role": "judge" }
]
```

**Why**: Today the video pipeline guesses. Election extracts the winner
by filtering primary_entities for "non-party-token person-shaped
strings". Legal-scandal has a hardcoded `EMPLOYER_ORGS` vs
`PROSECUTING_AGENCIES` split. These guesses are brittle. Tagging at
synthesis is correct once, forever.

**Where**: Synthesis prompt + migration. Wikipedia probe (P0-4) can
share extraction work.

**Effort**: M.

**Video impact**: DossierCard correctly identifies the named subject
across types. Affiliation/role chips become reliable. Entity-photo
target picking becomes deterministic.

---

### P1-5 ☐ Timeline events extraction

**What**: Synthesizer extracts a chronology from articles:

```jsonb
"timeline_events": [
  { "date": "2024-03-28", "label": "Sentenced to 25 years", "source_id": "doj_press_release" },
  { "date": "2023-11-02", "label": "Convicted on 7 counts", "source_id": "court_filing" },
  { "date": "2022-11-11", "label": "FTX files for bankruptcy", "source_id": "wsj_article" }
]
```

**Why**: TimelineCard today rebuilds events from
`published_at + source_doc.dates`, which on real data collapses to a
single day (Trump situation-room demo: 3 dots, all "March 28, 2024").
Real news stories have multi-month/year context — sentencing today,
conviction 6 months ago, indictment 2 years ago. Without explicit
timeline extraction, that context is lost.

**Where**: Synthesis prompt + migration.

**Effort**: M.

**Video impact**: TimelineCard renders meaningful chronology, not 3
dots on the same day.

---

### P1-6 ☐ Subject "history/context" copy

**What**: For every named person, generate a 1-sentence bio:

```jsonb
"primary_entities": [
  {
    "name": "Sam Bankman-Fried",
    "type": "person",
    "role": "defendant",
    "context": "Former CEO of crypto exchange FTX, founded the company in 2019; before founding it, traded at quant firm Jane Street."
  }
]
```

**Why**: User explicit request: *"a little bit history/context then the
news"*. Context lines anchor viewers — when the story is "X sentenced",
viewers want to know who X is and what they did. Today DossierCard shows
name + role + chips; adding a context line elevates the editorial.

**Where**: Synthesis prompt — generated alongside entity-type tagging.
Source: Wikipedia summary (already fetched by P0-4) + article context.

**Effort**: S (prompt extension on top of P0-4 + P1-4).

**Video impact**: DossierCard gains a one-line bio under the role.
"Wanted poster" feels closer to a news segment.

---

### P1-7 ☐ "Why it matters" / stakes line

**What**: One sentence explaining what the news means for a viewer.

**Why**: Mid-video, viewers ask "why am I watching this?". A stakes
line answers that. Today the video pipeline derives it weakly from
extracted metadata (`buildWhy({ ... })` per type).

**Where**: Synthesis prompt.

**Effort**: S.

**Video impact**: Could power a new module ("WhatThisMeans" — a
HookStrap-sized card after the numbers segment) or feed the
existing `audit.visual_angle`.

---

### P1-8 ☐ Source diversity scoring

**What**: Track the number of *independent* sources per story
(distinct domains / distinct issuer types / wire vs primary).
Score-weighted, not raw count.

**Why**: `source_count: 3` could be three Reuters re-prints (low
diversity) or one wire + one primary filing + one independent reporting
(high diversity). Today video shows the count without flagging the
difference. Stories with single-source coverage should be flagged so
the editor can decide whether to ship.

**Where**: Synthesizer / clusterer. Schema migration adds
`source_diversity_score` (0-1).

**Effort**: M.

**Video impact**: EvidenceShelf footer can read `"Sourced from 3
independent outlets"` vs `"Single-source coverage — wire pickup"`. Honest
attribution.

---

### P1-9 ☐ Verification status tracking

**What**: Track lifecycle state on a story:

```jsonb
"verification_status": "draft|verified|published|corrected|retracted",
"verification_notes": "Cross-checked figures with WSJ; one date discrepancy resolved by court filing date.",
"corrections": [
  { "ts": "2026-04-15T...", "what": "casualty figure revised from 14 to 17 per BNPB", "by": "editor" }
]
```

**Why**: Today the video pipeline trusts whatever the synthesizer
delivered, with no awareness of corrections or retractions. If a story
gets corrected post-render, the rendered MP4 still says the wrong
number. Tracking lets us re-render or pull from circulation.

**Where**: Synthesis + new editor tooling. Schema migration.

**Effort**: L (touches editor workflow, not just synthesis).

**Video impact**: Quality gate for what enters the video pipeline.
Stories below `verified` shouldn't render.

---

### P1-10 ☐ Conflicting-source detection

**What**: When two sources disagree on a key number, mark the story:

```jsonb
"factual_conflicts": [
  { "claim": "fraud amount", "values": ["$8B (DOJ)", "$10B (NYT)"], "preferred": "$8B (DOJ)" }
]
```

**Why**: Today video shows whichever number Claude picked first. Mature
news production marks divergence and explains it. A flagged conflict
should either:

1. Show both ("DOJ says $8B; NYT says $10B"), or
2. Not render until editor reconciles.

**Where**: Synthesis. Cross-checks during synthesis are an open
research problem; minimum viable: numeric-extraction divergence.

**Effort**: L.

**Video impact**: Honesty about uncertainty. Higher trust signal.

---

## P2 — Polish / future

### P2-1 ☐ Suggested visual concepts per story

**What**: 3-5 concrete visual concepts the renderer can map to module
beats:

```jsonb
"visual_concepts": [
  "Manhattan federal courthouse exterior",
  "FTX logo + customer-fund flow diagram",
  "Bankman-Fried mugshot (DOJ-public)",
  "Timeline chart: 2019 → 2024",
  "Cryptocurrency exchange volume chart"
]
```

**Why**: Today the visual angle is derived weakly inside each story
type's `understand()`. Letting Claude propose visuals at synthesis means
each story carries a list the editor can browse.

**Where**: Synthesis prompt.

**Effort**: S.

**Video impact**: Future module types (e.g. ChartCard, DiagramCard) can
be triggered by these hints. Today: editorial reference.

---

### P2-2 ☐ Related-story linking

**What**: At synthesis, link the story to ≤3 prior related stories in
the same cluster lineage:

```jsonb
"related_stories": [
  { "id": 4187, "headline": "FTX founder arraigned in SDNY", "date": "2022-12-13" },
  { "id": 5621, "headline": "Bankman-Fried convicted on 7 counts", "date": "2023-11-02" }
]
```

**Why**: News doesn't happen in isolation. A story about sentencing has
a 2-year context arc. Showing that arc in a video would dramatically
elevate context.

**Where**: Synthesis + new clustering logic across time.

**Effort**: L.

**Video impact**: Powers a future "Story Arc" module. Today: editorial.

---

### P2-3 ☐ Quote-eligibility flag for video render

**What**: Synthesizer flags whether the story's content is
appropriate for video synthesis:

```jsonb
"video_eligible": true,
"video_skip_reason": null
```

Eligibility criteria: not a developing breaking-news brief; not a
correction; not a paywalled-source single-pickup; subject not
sensitive (suicide, named minors, etc.); confidence ≥ 7.

**Why**: Today the video pipeline runs the audit step which can reject,
but it's a duplicate concern. Pre-flagging at synthesis lets the editor
batch-approve.

**Where**: Synthesis. Possibly a separate audit step.

**Effort**: M.

**Video impact**: Editorial gate. Reduces render of low-quality
candidates.

---

### P2-4 ☐ Multi-language source handling

**What**: Track original source language; flag stories whose synthesis
relied on translation.

**Why**: Translation introduces drift. A story translated from
Indonesian source coverage of an Indonesian event should be flagged so
the editor can verify.

**Where**: Scraper + synthesizer.

**Effort**: M.

**Video impact**: Honesty about provenance.

---

### P2-5 ☐ Subject portrait override list

**What**: Curated dictionary of `entity_name → preferred_image_url +
attribution + license`. Overrides Wikipedia for cases where Wikipedia's
default lead image is unflattering, dated, or off-context. Editor-
maintained.

**Why**: Wikipedia's lead image for some figures is unflattering or
years out of date. A small editor-curated override list lets us swap in
better-quality press photos with proper licensing.

**Where**: New `editorial_overrides` table or JSON file. Synthesizer
checks the override list before falling back to Wikipedia.

**Effort**: M (storage + UI for editor + integration).

**Video impact**: Higher portrait quality on prominent figures.

---

### P2-6 ☐ Story expiry / freshness markers

**What**: Per-story "decay" timestamp. Stories older than N days get
flagged as "history" rather than "news".

**Why**: A 6-month-old story showing up in today's daily quiz is fine,
but rendering it as a video without a freshness marker is dishonest.

**Where**: Synthesis + render-time check.

**Effort**: S.

**Video impact**: Optional "ARCHIVE" posture chip on older stories.

---

### P2-7 ☐ Audio pronunciation hints for unusual names

**What**: Per-entity phonetic spelling for TTS:

```jsonb
"name": "Lula da Silva",
"phonetic": "LOO-lah da SEEL-vah"
```

**Why**: ElevenLabs mispronounces non-English names regularly. Storing
phonetic spellings lets the renderer substitute "lula" → "loola" in the
TTS prompt only.

**Where**: Synthesis (could come from Wikipedia IPA) + render-time
substitution layer.

**Effort**: M.

**Video impact**: Audible quality improvement on every story with a
non-English name.

---

## What to NOT chase yet

- **AI-generated B-roll / video footage**: real video footage is
  licensing-heavy and AI-generated event imagery breaks our editorial
  spine. Skip.
- **Custom voice cloning**: not on the table until standard voices fail
  consistently. They don't.
- **Real-time TTS during synthesis**: we want the synthesis output to be
  static / cacheable. Render-time TTS is fine.
- **Live-source crawling at render time**: same — synthesis is the
  freeze point. Render is deterministic from frozen story row.

---

## Suggested execution order

If you do nothing else, do these three first:

1. **P0-1** (source documents inline) — biggest single quality lift,
   restores attribution chain across every module.
2. **P0-2** (verbatim quotes) — restores the QuoteCard beat which is
   currently silent on every Supabase render.
3. **P0-3** (readable place names) — restores MapCallout + place photos.

Re-run the 10-story Supabase batch after each. The video output should
get visibly stronger after each one.

After P0 lands, attack the P1 items in any order — they're independent.
Knock down extraction (P1-1), hook (P1-2), entity tagging (P1-4),
context/bio (P1-6) as a four-item batch and re-render once for a
combined view.

P2 items are valuable but not the bottleneck. Defer until P0 + P1 are
done.

---

## Cross-codebase touchpoints

| Change site | Items | Notes |
|---|---|---|
| `azure-functions/story-synthesizer/index.js` | P0-1, P0-2, P0-3, P0-4, P0-5, P1-1, P1-2, P1-3, P1-4, P1-5, P1-6, P1-7, P2-1, P2-3 | Most synthesis-side work lives here. Schema migrations go in `backend/db/`. |
| `azure-functions/article-clusterer/index.js` | P0-3, P0-5 | Geo enrichment, archetype hints |
| `azure-functions/article-scraper/index.js` | P2-4 | Source language detection |
| `azure-functions/lib/wikipedia.js` (NEW) | P0-4 | Mirror of `video-pipeline-v2/src/integrations/wikimedia.js` |
| `backend/db/migration_*.sql` | All schema-touching items | One migration per item, idempotent |
| `video-pipeline-v2/src/integrations/supabase.js` | All — adapter must read new fields | Keep backward compatibility via `??` fallbacks |
| `video-pipeline-v2/src/pipeline/understand/story-types/*.js` | P1-1, P1-3, P1-4 | Types simplify once synth provides structured fields |
| `video-pipeline-v2/src/render/modules/*.tsx` | P1-6, P2-7 | DossierCard adds bio line; new TTS substitution layer |

---

## Acceptance test (the only honest one)

After each P0 item lands, run:

```sh
cd video-pipeline-v2
$env:MAPBOX_AUTO_GEOCODE = "true"
node scripts/fetch-supabase-batch.js --count 10 --use-ai --verified false
```

Compare the rendered MP4s and the per-story `script.json` files
against the previous baseline. Specifically check:

- How many stories have an EvidenceShelf with ≥2 sources (was: 0/10)
- How many fire a QuoteCard (was: 0/10)
- How many fire a MapCallout with a Wikipedia place photo (was: 1/10)
- How many fire a DossierCard with a Wikipedia portrait (was: 0/10)
- The narration's specificity — does it name the official agency, the
  date, the figure, the verbatim phrase?

The numbers in parentheses are the current baseline from the May 4
batch. After P0-1 + P0-2 + P0-3, expect 8-10 / 10 on every line.

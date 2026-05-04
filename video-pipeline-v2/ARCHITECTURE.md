# Quydly v2 Video Pipeline — Architecture

This document is the navigation index for the v2 evidence-first video pipeline.
Read this first; reference the linked files only when you need details.

## What it is

A Node.js pipeline that consumes a story (headline / summary / key_points /
sources) and produces a 30-60 second editorial video via Remotion. Designed to
be:
- **Story-type-agnostic** at the orchestrator level — types are plug-in modules
- **Evidence-first** — every visual carries a source citation; no AI-generated
  portraits or stock footage masquerading as event coverage
- **Fail-loud, fail-graceful** — silent degradation surfaces in
  `fallback-report.json`; production mode refuses degraded output

Currently 8 story types: `legal_scandal`, `geopolitics_world`, `finance_markets`,
`election_result`, `natural_disaster`, `tech_cyber`, `culture_entertainment`,
`general` (last-resort fallback).

## How to run

```sh
# Single story, dry run (no TTS, no render)
node index.js --story-file fixtures/sample-story-election.json --dry-run-fallbacks

# Single story, full production render with AI scripts
node index.js --story-file fixtures/sample-story-election.json --use-ai --mode production

# Lint all fixtures
npm run lint:fixtures

# CI gate: typecheck + strict lint
npm run ci:check

# Scaffold a new fixture from a topic line
npm run author:fixture -- --topic "..." [--type election_result]

# Pull random Supabase stories and render them
npm run supabase:batch -- --count 10 [--use-ai]
```

Required env (in `.env` at v2 root or sibling `evidence-first-video-pipeline/.env`):
- `ANTHROPIC_API_KEY` (for `--use-ai` and `author:fixture`)
- `ELEVENLABS_API_KEY` (TTS; synthetic timing fallback if absent)
- `MAPBOX_TOKEN` (map module rendering)
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (for `supabase:batch`)
- `MAPBOX_AUTO_GEOCODE=true` (recommended for batch runs against real data)

## Pipeline stages (sequential)

The orchestrator (`src/pipeline/orchestrator.js`) is the single source of truth.
Each stage logs `[STATE] message` and accumulates fields onto a single mutable
`storyPackage` variable.

```
QUEUED
  → STORY_VALIDATED       loadStory + validateStory
  → (audit, separate var) auditVideoCandidate; may VIDEO_CANDIDATE_REJECTED
  → STORY_UNDERSTOOD      classify(story) → type.understand(story, audit)
  → EVIDENCE_PACKAGED     evidence-package composer + type.evidenceAssets()
  → SCRIPT_READY          type.script() (deterministic) or type.aiScript() (Claude)
  → VOICE_READY           ElevenLabs TTS or synthetic char-level timing
  → MODULE_PLAN_READY     type.template() + voice-driven module timings
  → ASSETS_READY          resolve-assets walks modules, fetches Mapbox tiles
  → SUBTITLES_READY       generate-srt from voice alignment
  → write fallback-report.json
  → (dry-run exits here) / production gate / RENDERING (Remotion) → RENDER_READY
```

`storyPackage` field contract is documented as a comment at the top of
`orchestrator.js`. `expectFields()` runtime-guards against accidental drops.

## Code layout

```
src/
├── pipeline/
│   ├── orchestrator.js               ← state machine, top of every run
│   ├── job-states.js                 ← state-name string constants
│   ├── selectors/load-story.js       ← read fixture file → normalize → validate
│   ├── audit/
│   │   ├── video-candidate-audit.js  ← reject unsuitable stories before pipeline
│   │   └── fallback-report.js        ← survey for silent degradation
│   ├── understand/
│   │   ├── understand-story.js       ← thin dispatcher: classify → type.understand
│   │   ├── story-types/
│   │   │   ├── index.js              ← TYPES registry + classify(story)
│   │   │   ├── legal-scandal.js
│   │   │   ├── geopolitics.js
│   │   │   ├── finance-markets.js
│   │   │   ├── election.js
│   │   │   ├── natural-disaster.js
│   │   │   ├── tech-cyber.js
│   │   │   ├── culture-entertainment.js
│   │   │   └── general.js            ← priority 1, last-resort fallback
│   │   └── shared/
│   │       ├── extractors.js         ← collectText, uniqueMatches, extractMoney,
│   │       │                            parseAmount, formatDate, indexSegments,
│   │       │                            cap, safeForPrompt, wordIncludes
│   │       └── templates.js          ← buildQuote/Map/Timeline/EvidenceShelf/Outro
│   │                                    Segment(), runAiScript(),
│   │                                    extractVerbatimQuote, extractTimelineEvents,
│   │                                    deriveSourceCitation
│   ├── evidence/evidence-package.js  ← composer; pulls assets from type
│   ├── script/generate-script.js     ← dispatcher; routes deterministic vs AI
│   ├── voice/generate-voice.js       ← ElevenLabs wrapper
│   ├── modules/plan-modules.js       ← type.template() + applyVoiceTimings
│   ├── assets/resolve-assets.js      ← walks modules, fetches Mapbox
│   ├── subtitles/generate-srt.js     ← character-level alignment → SRT
│   └── render/
│       ├── prepare-render-props.js   ← copies assets to public/jobs/, builds RenderProps
│       └── render-video.js           ← invokes Remotion CLI
│
├── integrations/
│   ├── anthropic.js                  ← Claude SDK + completeJSON()
│   ├── elevenlabs.js                 ← TTS + synthetic timingOnly() fallback
│   │                                    Voice settings env-overridable; default
│   │                                    voice Sarah (EXAVITQu4vr4xnSDxMaL)
│   ├── mapbox.js                     ← Static Images + GAZETTEER + forwardGeocode
│   ├── wikimedia.js                  ← Wikipedia entity-photo fetcher with
│   │                                    strict title-match safety
│   ├── music.js                      ← Music-bed picker; reads
│   │                                    public/music/<storyType>/*.{mp3,...}
│   ├── http.js                       ← fetchWithRetry [400, 1500, 4000]ms backoff
│   └── supabase.js                   ← Supabase client + adapter (story row → fixture)
│
├── shared/
│   ├── config.js                     ← OUTPUT_ROOT
│   ├── brand.js                      ← BRAND_VOICE.tagline, STORY_ACCENTS map (CJS)
│   └── story-normalizer.js           ← normalizeStory(), validateStory(mode)
│
├── render/                           ← Remotion render-side (TypeScript)
│   ├── Root.tsx                      ← Composition registration
│   ├── EvidenceVideo.tsx             ← top-level <Composition> body
│   ├── modules/
│   │   ├── HookStrap.tsx
│   │   ├── DossierCard.tsx
│   │   ├── NumberCard.tsx
│   │   ├── ChargeCard.tsx
│   │   ├── QuoteCard.tsx
│   │   ├── MapCallout.tsx
│   │   ├── TimelineCard.tsx
│   │   ├── EvidenceShelf.tsx
│   │   └── OutroLockup.tsx
│   └── shared/
│       ├── brand.ts                  ← TS mirror of brand.js — keep in sync
│       ├── layout.ts                 ← ZONE constants
│       ├── motion.ts                 ← BEAT/EASE + hooks (useBeat, useSpringIn,
│       │                               useCountUp, useDrawIn, useRiseIn,
│       │                               useStaggered, useBreath, useFadeIn, pickText)
│       ├── chrome.ts                 ← PostureChip, PostureChipRow, Eyebrow,
│       │                               SourceChip, readPostureChips, readEvents,
│       │                               readChipsList
│       ├── icons.tsx                 ← DocIcon, ExternalGlyph
│       ├── ModuleSurface.tsx         ← shared bg + safe-area frame
│       └── types.ts                  ← RenderModule, RenderAsset, VideoProps, etc.
│
└── cli/generate-video.js             ← single-story CLI entry point

scripts/
├── lint-fixtures.js                  ← walk fixtures/, dry-run each, table output
├── author-fixture.js                 ← Claude scaffolds fixture from topic
└── fetch-supabase-batch.js           ← Supabase → batch render

fixtures/
├── sample-story-*.json               ← human-authored / canonical fixtures
└── scaffolded-*.json                 ← author-fixture output

output/
├── story-<id>/v<N>/                  ← per-run versioned artifacts
├── .batch/                           ← frozen Supabase fixture snapshots
└── .lint/                            ← linter-only output (gitignorable)
```

## Key abstractions

### Story type module (the plugin contract)

Every type module in `src/pipeline/understand/story-types/` exports:

```js
module.exports = {
  id: 'unique_string',              // story_type tag
  priority: 100,                    // tiebreak in classify(); higher wins
  matches(story): boolean,          // routing predicate (use wordIncludes)
  understand(story, audit),         // → understanding {entities, numbers, legal,
                                    //   timeline_events, visualizable_concepts,
                                    //   metadata, verbatim_quote, ...}
  evidenceAssets(understanding, story), // → {assets, source_documents,
                                        //    safety_notes, forbidden_visuals}
  script(evidencePackage, audit),   // → script {hook, body, full_script,
                                    //   segments[{role,text}], title_variants,
                                    //   thumbnail_copy, overlay_phrases,
                                    //   estimated_duration_sec, generation_source}
  aiScript?(evidencePackage, audit), // optional Claude path; same shape
  template(evidencePackage, scriptObj), // → array of module entries (Hook/etc.)
};
```

Add a new type: write the module file, register in `index.js`, add brand accent
in BOTH `src/shared/brand.js` and `src/render/shared/brand.ts`, add a fixture
to validate.

### Module entry (template output → renderer input)

```js
{
  role: 'hook' | 'numbers' | 'dossier' | 'quote' | 'map' | 'timeline' |
        'charges' | 'evidence_shelf' | 'outro',
  componentType: 'HookStrap' | 'NumberCard' | 'DossierCard' | 'ChargeCard' |
                 'QuoteCard' | 'MapCallout' | 'TimelineCard' |
                 'EvidenceShelf' | 'OutroLockup',
  startSec, durationSec,            // populated by plan-modules from voice timing
  overlayText, narration, assetClass,
  data: { /* component-specific shape */ },
  asset: { kind, src, path, sourceUrl, credit, license, safetyClass,
           fallbackReason, fallbackHint },
  assetNeed?: { kind: 'map', geoLocation: 'City' },  // requested in template
}
```

Allowed roles are validated in `generate-script.js:KNOWN_SEGMENT_ROLES`. Adding
a new role requires adding to that set.

### Voice result

```js
{
  audioPath,                        // null if synthetic
  alignment: {
    characters,                     // array of single-char strings
    character_start_times_seconds,  // parallel array of floats
    character_end_times_seconds,    // parallel array
  },
  totalDurationSec,
  isTimingOnly: boolean,            // true = synthetic
  forcedSynthetic: boolean,         // true = forced via --dry-run-fallbacks
}
```

### Fallback report item

```js
{
  stage: 'voice' | 'script' | 'assets',
  kind: 'string id',                // e.g. 'off_gazetteer', 'mapbox_http_401'
  severity: 'low' | 'medium' | 'high',
  detail?: 'human-readable hint',   // populated from mapbox.fetchMap return
  moduleId?, role?, componentType?, // for stage=='assets'
}
```

## Design decisions (the non-obvious ones)

1. **storyPackage progressive accumulation.** Single mutable variable; each
   stage adds fields. `expectFields()` guards against drops. Comment at top of
   `orchestrator.js` is the contract — update it when a stage adds a field.

2. **Story-type registry with priority field.** Keyword matching is intentionally
   simple and fast. `priority` tiebreaks ties: e.g. `election_result` (110)
   wins over `geopolitics_world` (100) when both match the word "election".
   `general` (priority 1) is the last-resort safety net.

3. **`wordIncludes` over `text.includes`.** Whole-word match on every type's
   matches() to prevent substring false positives. Bug from history: geopolitics'
   `accord` substring-matched `according to` in a disaster fixture.

4. **Dual extraction strategy.** Every type has a deterministic `script()` AND
   an optional `aiScript()`. Pipeline calls AI when `useAI: true` and falls back
   to deterministic on ANY error (network, validation, missing key). Keeps the
   pipeline shippable air-gapped.

5. **Verbatim quotes only.** Pipeline NEVER paraphrases for QuoteCard. If the
   source has no `quote_text`, the QuoteCard module is skipped entirely. The
   editorial cost of a fake-feeling quote outweighs the visual variety.

6. **Asset resolver returns structured failures.** `mapbox.fetchMap()` returns
   `{ ok: true, ...meta }` or `{ ok: false, reason, hint }`. The hint is shown
   in `fallback-report.json :: items[].detail` so debugging is one-glance.

7. **Production gate.** `--mode production` refuses to render if
   `fallback-report.has_fallbacks`, unless `--allow-fallbacks` is set.
   Failsafe against shipping degraded output.

8. **Dry-run forces synthetic voice.** `--dry-run-fallbacks` runs the full
   pipeline up to (not including) render but skips ElevenLabs entirely.
   Costs only Mapbox calls. Used by the linter and the batch script's smoke
   tests. The `forcedSynthetic` marker on the voice result tells
   `buildFallbackReport` not to count the synthetic timing as a real fallback.

9. **`runAiScript` shared executor.** Each type owns its system prompt; the
   delimiter-bounded user message, prompt-injection defenses (`safeForPrompt`),
   and Claude call are centralized in `templates.runAiScript`. Adding a new
   AI type means writing the system prompt only.

10. **Brand mirror in two languages.** `src/shared/brand.js` (CJS, Node) and
    `src/render/shared/brand.ts` (TS, Remotion) must stay in sync. STORY_ACCENTS
    and BRAND_VOICE appear in both. **When adding a story type, add to BOTH.**

11. **Auto-geocode opt-in via env.** `MAPBOX_AUTO_GEOCODE=true` enables
    forward-geocoding of off-gazetteer places. Off by default (avoid surprise
    API spend); on by default for `supabase:batch`.

12. **Fixture as canonical input.** Stories from any source (Supabase,
    hand-authored, Claude-scaffolded) are converted to the same fixture shape
    before entering the pipeline. The pipeline doesn't know about Supabase;
    `src/integrations/supabase.js` adapts.

14. **Entity photos via Wikipedia, strict title-match enforced.** Wikipedia
    REST API is the source for portraits of named subjects (DossierCard) —
    real CC-BY-SA photos with structured attribution. **Two safety locks**
    against showing the wrong person: `?redirect=false` query param +
    `redirect: 'manual'` fetch option (so we see 30x at the wire), AND a
    token-by-token title-match check (every queried-name token must appear
    in the article title). Without these, Wikipedia silently redirects
    unknown names to related articles and serves the wrong photo. Failure
    modes (`title_mismatch`, `wikipedia_404`, `disambiguation`) all surface
    as `fallback-report` items; DossierCard renders typographic-only
    layout when no photo.

13. **DRY templates layer.** Common module builders (Quote/Map/Timeline/
    EvidenceShelf/Outro) and `runAiScript` live in `understand/shared/templates.js`.
    Each type's `template()` calls the helpers and only writes the bits that
    differ (Hook headline, NumberCard data, posture chip text, footer copy).

## Conventions

- **`primary_entities`**: lowercase tokens (`["lina aksel", "reform alliance"]`).
  Display layer Title-Cases as needed.
- **`primary_geos`**: Proper Case place names (`["Reykjavik", "Iceland"]`) so
  the gazetteer matches without normalization.
- **Story IDs**: string or number; orchestrator stringifies for output dir.
- **`published_at`**: ISO 8601.
- **`source_documents[*].date`**: `"Month D, YYYY"` string (matches `formatDate` output).
- **`quote_text`**: if present, used verbatim. Never paraphrase.
- **PostureChip text**: ALL CAPS, short (`"OFFICIAL TALLY"`, `"ALLEGED"`,
  `"DISCLOSURE STATEMENT"`). Owned by the type's template; document conventions
  in the type file.
- **Story-type IDs**: `snake_case`. Match the `STORY_ACCENTS` map keys exactly.
- **AI generation_source tags**: `anthropic_<type_id>_v1` / `deterministic_<type_id>_v1`.

## Operational tools

| Command | Purpose |
|---|---|
| `npm run generate -- --story-file PATH` | Single-story render (also `--story-id N`) |
| `npm run lint:fixtures` | Walk `fixtures/`, dry-run each, table output |
| `npm run lint:fixtures:ci` | Same but `--ci --exclude "*fallback-test*,scaffolded-*"` |
| `npm run ci:check` | typecheck + lint:fixtures:ci (pre-commit gate) |
| `npm run author:fixture -- --topic "..."` | Claude scaffolds new fixture |
| `npm run supabase:batch -- --count N` | Pull N from Supabase, render |
| `npm run typecheck` | `tsc --noEmit` over render-side TS |
| `npm run studio` | Open Remotion Studio for visual review |

CLI flags worth knowing:
- `--mode poc | production` — validation strictness + fallback gate
- `--allow-fallbacks` — bypass production gate
- `--dry-run-fallbacks` — synthetic voice + exit before render (cheapest)
- `--skip-render` — full pipeline, skip MP4 (still pays TTS)
- `--use-ai` — Claude scripts (deterministic fallback on error)

## Common modification recipes

**Add a new story type:**
1. Create `src/pipeline/understand/story-types/<id>.js`. Easiest: copy
   `culture-entertainment.js` (uses templates already, ~600 lines).
2. Register in `src/pipeline/understand/story-types/index.js`.
3. Add accent in BOTH `src/shared/brand.js` and `src/render/shared/brand.ts`.
4. Add fixture `fixtures/sample-story-<theme>.json` with `is_verified: true`.
5. `npm run lint:fixtures` to validate routing + render-prop shape.
6. `node index.js --story-file ... --use-ai --mode production` for full render.

**Add a city to the gazetteer:**
- Edit `GAZETTEER` in `src/integrations/mapbox.js`. Add
  `'city name': { lon, lat, zoom }`.
- Or skip and set `MAPBOX_AUTO_GEOCODE=true`.

**Change a posture chip label:**
- Find in the type's `template()` function in
  `src/pipeline/understand/story-types/<id>.js`.
- Posture chips are passed as `data.postureChips: [{ text, tone }]`.
- Render-side reads via `readPostureChips` in `src/render/shared/chrome.ts`.

**Change AI script style for a type:**
- Edit `AI_SYSTEM_PROMPT` constant in the type file.
- Re-run with `--use-ai` to test.

**Add a new module component:**
1. Create `src/render/modules/<Component>.tsx`. Use `ModuleSurface` for the
   bg/safe-area wrapper.
2. Add to `ComponentType` union in `src/render/shared/types.ts`.
3. Wire in `src/render/EvidenceVideo.tsx`'s switch.
4. Reference from a type's `template()` via `componentType: '<Component>'`.
5. If the role is new (not in `'hook'|'numbers'|'dossier'|'quote'|'map'|
   'timeline'|'charges'|'evidence_shelf'|'outro'`), add to `KNOWN_SEGMENT_ROLES`
   in `src/pipeline/script/generate-script.js`.

**Add a new extraction helper:**
- If shared across types, add to `src/pipeline/understand/shared/extractors.js`.
  Existing patterns: `extractMoney` (regex with word boundaries), `parseAmount`
  (numeric value with units), `wordIncludes` (whole-word substring), `formatDate`
  (ISO → "Month D, YYYY").
- If type-specific, keep it in the type file.

**Debug an off-gazetteer geo:**
- Look at `output/<dir>/v<N>/fallback-report.json` → `items[].detail`. Mapbox
  hints are explicit ("X not in mapbox.js GAZETTEER", "HTTP 401: invalid token",
  etc.).

**Add a country code to the geo translator:**
- Edit `COUNTRY_CODE_TO_NAME` in `src/integrations/supabase.js`.
- Translates Supabase's lowercase ISO codes (`["us"]`) → readable
  names (`["United States"]`) the gazetteer/geocoder can resolve.

## Known limitations / future work

- **AI hook headline channel.** Visual hook overlay is deterministic even when
  narration is AI. To override, pipe `script.hook_headline` from AI through to
  template (slice 32 deferred).
- **TimelineCard same-date dedup.** Synthetic fixtures often have identical
  dates on multiple events; renderer shows multiple dots on the same day.
- **DossierCard chip overflow.** Not auto-truncated. Long affiliation strings
  may push chip row past safe area.
- **Verbatim quotes never sourced from Supabase data.** No `quote_text` column
  on stories. Real production needs a quote-extraction step at synthesis time.
- **Pruned `raw_articles`.** Real Supabase stories have `cluster.article_ids`
  but the rows have been retention-pruned. `source_documents` is often empty.
  Potential fix: fall back to `cluster.unique_domains` for domain-only attribution.
- **Subtitle word breaks.** ElevenLabs character-alignment occasionally splits
  cues across sentence boundaries (`"2026. Know the story."`).
- **`general` story type is minimal.** No DossierCard / ChargeCard, simple
  HookStrap. Only fires when no specific type matches. Used by the Supabase
  batch as a safety net.
- **Visual audit.** Static checks pass typecheck and prop shape; actual visual
  pacing/easing must be reviewed in Remotion Studio (see slice 31 checklist
  in conversation history).

## Slice history (high-level)

The codebase grew slice by slice. Each slice produced a versioned video output
and was code-reviewed by Codex before the next started.

- **Slices 1-10**: Pivot to v2 layout, motion-token system, shared chrome
  primitives, story-type registry skeleton.
- **Slices 11-15**: Hardening — prompt-injection defense, audio sync via
  `applyVoiceTimings`, atomic version dirs, retry/backoff in HTTP integrations.
- **Slice 17**: Production gate on fallbacks.
- **Slice 18**: `--dry-run-fallbacks` flag.
- **Slice 20**: Election story-type (priority 110, validated routing).
- **Slice 21**: First pass of `shared/templates.js` + observability hints +
  fixture linter + election AI path.
- **Slice 23**: Natural-disaster story-type.
- **Slice 25**: Tech-cyber story-type.
- **Slice 26**: `ci:check` wrapper + `--exclude` flag for the linter.
- **Slice 28**: DRY refactor — all 6 specific types use `shared/templates.js`.
- **Slice 30**: Culture-entertainment story-type (built on templates from day one).
- **Slice 33**: Mapbox auto-geocode + `author-fixture --type` flag.
- **Slice 34**: Supabase batch runner + `general` fallback type.
- **Slice 35 Stage A**: Wikipedia entity-photo integration in DossierCard
  (legal_scandal). Strict title-match safety after a near-miss where
  Wikipedia returned Trump's situation-room photo for a fictional
  defendant.
- **Slice 35 Stage B**: Spread entity photos to election DossierCard.
  Add place photos to MapCallout — `resolveMap` tries Wikipedia first
  (real photo of Strait of Hormuz / Reykjavik / Manhattan beats a vector
  map tile for relatability), falls back to Mapbox on miss. Diacritic
  normalization in titleMatchesName so "Reykjavík" matches "Reykjavik".
- **Slice 36**: Outro removed entirely (8 types + KNOWN_SEGMENT_ROLES).
  AI word caps bumped, then narrowed in slice 38.
- **Slice 37**: TTS voice settings env-overridable (`ELEVENLABS_STABILITY`,
  `_STYLE`, `_SIMILARITY_BOOST`, `_USE_SPEAKER_BOOST`). New defaults
  (0.45 / 0.40 / 0.78 / true) for news-anchor delivery vs the old flat
  default. `--voice` CLI flag for one-off swaps.
- **Slice 38**: Sarah set as default voice (female news-style). Spoken-
  delivery prompt rewrite across all 8 types — 35-45s target, 8-10
  sentences, hook + strong end, plain English, no stacked facts. Music
  bed integration: `src/integrations/music.js` picks from
  `public/music/<storyType>/`, falls back to `public/music/default/`,
  silent when neither exists. Render adds a second `<Audio>` track at
  constant volume 0.12 under narration.

For full slice-by-slice rationale, search the conversation history for
`Slice <N>:`.

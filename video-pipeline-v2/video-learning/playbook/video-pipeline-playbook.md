# Video pipeline playbook

Version: 1.2.0
Last updated: 2026-05-09

The standing rules every story is held to. A fresh Claude reads this once
at the start of each story, then follows the rules. Edits to this file
happen *between* stories, never mid-flow.

This file pairs with `claude-runner.md` (operating sequence) and the
workspace system at `stories/`. Artifacts referenced below live in
`stories/<id>/`.

---

## 1. Global quality rules

These hold for *every* video, regardless of story type.

### Format
- **Length**: 60–90 seconds, total.
- **Pace**: 165 words per minute → 165–250 spoken words.
- **Module count**: 4–7. Always opens with `hook`, always closes with `close`.
- **Total duration drift**: module plan must match script length within ±2s.

### Sourcing
- Every spoken claim traces to a `key_fact` or `numeric_fact` in
  `02_evidence.json`. Trailing `<!-- src: <id> -->` HTML comments in
  `03_script.md` are mandatory for any number, name, or quote.
- Quotes must be verbatim from `02_evidence.quotes[]`. No paraphrase
  rendered as a quote.
- Conflicts (`02_evidence.factual_conflicts`) must surface in the script
  if they bear on the hook, stakes, or any cited number. They are never
  resolved by picking the more convenient figure.

### Publishability gates
- `status: "insufficient"` in `02_evidence.json` ends the flow at stage 2.
  No render attempt.
- `verification_status === 'draft'` *and* `source_diversity_score < 0.40`
  → render is blocked unless the operator overrides explicitly.
- Stage 5 with non-empty `blockers` → render is blocked. Iterate.

The full gate list lives in `prompts/02-evidence-package.md` §
Publishability decision; the standing rules captured here:

- **Source independence.** Sources that share a domain root, a sister-
  site network (`tools/lib/source_networks.py`), or a single byline on
  ≥75% of articles count as one perspective. The pipeline rejects
  stories whose source set collapses to a single perspective.
- **Trust the synth's quality signals.** When the upstream synthesizer
  has tagged a row with `quiz_candidate=false` AND
  `editorial_posture='disclosure_official'`, *or* with both
  `MIXED_STORY` and `NUMERIC_TRIVIA_RISK` in `quality_flags`, *or* with
  `consistency_score < 0.30`, the video pipeline does not overrule the
  synth — it stops at stage 2. Service-journalism / retail-deal /
  affiliate-aggregation patterns get rejected at stage 1 step 0; the
  tools (`tools/lib/story_type.py` + `tools/prepare_story_context.py`)
  auto-seed a minimal rejection workspace (`story.json`, `_meta.json`
  with `outcome: "rejected"`, `_blockers.md`, `08_learning.json`) so
  the rejection is captured in the learning index even though no
  Claude session opens.
- **Defence in depth.** Stage 5 mirrors the synth-flag gates as C22
  (`prompts/05-pre-render-critic.md`) so a stale stage-2 prompt does
  not let weak stories through to render.

### Voice
- No moralising adjectives (`brutal`, `tragic`, `shocking`, `heroic`,
  `devastating`). Banned in script and on-screen text.
- No hedge words in the hook or stakes line (`could`, `may`, `seems`,
  `appears`, `what if`).
- No questions in the hook.

### Visual asset rule of thumb (HARD RULE)

Every rendered module MUST display a real image. Placeholders, generic
gradients, and text-only frames are render failures regardless of script
quality. A module's image is sourced in this priority order:

1. **Person photo** — Wikipedia pageimage of any
   `primary_entities_enriched[].name` (type=`person`) that appears in the
   module text. Editor-curated overrides (`entity_portrait_overrides`) win
   over Wikipedia when present.
2. **Country flag / labelled map** — when the module text names a
   country/region present in `primary_geos`, render the flag (or for
   `kind: "map"`, a labelled-region map of the named theatres).
3. **Iconic concept image** — bank, parliament, dollar/money, vehicle,
   oil rig, military, police, law/court, sports — drawn from
   `02_evidence.visual_concepts[]` or derived from `story_type` + module
   text keywords. Curated stock library (committed to the repo), not
   generated.
4. **NumberCard with a real bound numeric** — only for `kind: "stakes"`
   or a data-class evidence module with a `numeric_fact_ref` whose value
   is a JS number (not a date string). The number IS the visual; the
   plate is the asset.

If none of (1–4) apply for a module, **the plan is wrong**. Go back to
stage 4 and either re-shape the module so one of the rules applies, or
drop the module entirely. A module that cannot be filled by this ladder
is not allowed to render.

Stage 7 (post-render critic): any manifest with `asset_status:
"placeholder"` on >0 modules is a render failure. Decision is `iterate`
or `awaiting-bridge` — never `published`.

The synth side enforces a matching gate: rows whose
`primary_entities_enriched` is empty (and `story_type` is not
`finance_markets`), or whose `primary_geos` is empty AND
`visual_concepts.length < 2`, are flagged `video_eligible=false` with
reason `no_enriched_entities` or `visual_starvation`. The video pipeline
should never see a row that cannot satisfy the rule.

---

## 2. Failure taxonomy

Every entry in `08_learning.json` whose `category` is `failure` belongs to
one of these classes. The class determines which check tightens.

| Class                  | Manifests as                                                         | Check that catches it next time                                                                                  |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sourcing/unsourced`   | Script asserts a number or quote with no `<!-- src: --->` comment.   | Stage 5: regex on `03_script.md` for digits and quotes; fail any without trailing src comment.                   |
| `sourcing/single`      | Casualty / dollar / vote tally cited from one source only.           | Stage 5: any `numeric_fact` with `source_ids.length === 1` must have explicit "according to <body>" in script.   |
| `sourcing/paraphrase`  | Paraphrased line rendered as `kind: "quote"` module.                 | Stage 5: every quote module's `text` must equal a string in `02_evidence.quotes[].text`.                         |
| `sourcing/network-overlap` | All sources collapse to a single editorial network or share a single byline on ≥75% of articles. | Stage 2 gate-2a (same-author concentration) + gate-2b (single editorial network via `tools/lib/source_networks.py`). |
| `sourcing/synth-flag-ignored` | Pipeline produced a video for a row the synth had already flagged (quality_flags, quiz_candidate=false, low consistency_score). | Stage 2 gates 5 / 6 / 7; stage 5 C22 mirrors them as defence in depth. Stage 1 step 0 rejects service-journalism rows before workspace creation. |
| `hook/question`        | Hook starts with a question or contains `?`.                         | Stage 5: scan Hook section for `?`. Fail.                                                                        |
| `hook/hedge`           | Hook contains banned hedge word.                                     | Stage 5: word-list scan on Hook + Stakes sections.                                                               |
| `hook/generic-opener`  | "In a major development", "Breaking:", "Big news".                   | Stage 5: prefix scan on hook text against banned-prefix list.                                                    |
| `stakes/abstract`      | Stakes mentions "the world", "everyone", "many people".              | Stage 5: token scan; require ≥1 digit-bearing token in Stakes.                                                   |
| `stakes/moralising`    | Stakes uses banned adjective.                                        | Stage 5: word-list scan.                                                                                         |
| `module/order`         | Plan starts with non-`hook` or ends with non-`close`.                | Stage 4 schema; stage 5 re-checks.                                                                               |
| `module/duration-drift`| Sum of `duration_sec` differs from script length by >2s.             | Stage 4: compute and compare to script word count / 165 \* 60.                                                   |
| `module/asset-mismatch`| `asset_hint: "photo"` with no image source in `02_evidence`.         | Stage 5: every photo hint must trace to an image-bearing source.                                                 |
| `module/text-paraphrase`| Module `text` differs from any sentence in `03_script.md`.          | Stage 5: substring match each module's `text` against the script.                                                |
| `render/overflow`      | On-screen text exceeded the safe area / clipped.                     | Post-render check: each module's `text` length ≤ per-kind cap (see §3).                                          |
| `render/mistimed-cut`  | Cut happens mid-word or before key noun is read.                     | Post-render: compare `manifest.json` cut times against TTS word boundaries.                                      |
| `render/missing-asset` | Module rendered with placeholder where `asset_hint` failed.          | Post-render: scan manifest for `asset_status: "fallback"`; treat as warn or blocker per kind.                    |
| `render/visual-starvation` | Manifest ships with 100% placeholder modules — row had no person photos / flags / concept stock to draw on. | §1 Visual asset rule of thumb. Synth gate `video_eligible=false reason='visual_starvation'` upstream; stage 7 logs `architecture/visual-starvation` blocker if it slips through. |
| `learning/vague`       | `08_learning.json` entry has no testable `future_check`.             | `update_learning.py` rejects entries where `future_check.length < 5`.                                            |
| `learning/no-rollup`   | Entry never gets surfaced in `LEARNING_RECORD.md`.                   | `update_learning.py` is non-optional; runner reminds operator at stage 8 close.                                  |

When a failure of a class repeats across 2+ stories, promote the *check*
to a decision rule in §6 and link the prior incidents.

---

## 3. Text hierarchy rules

On-screen text is the difference between a video and a slideshow. These
rules govern overlay copy *and* the script-to-overlay mapping.

### Three hierarchy levels

| Level | Role                            | Size          | Persistence              | Examples                                      |
| ----- | ------------------------------- | ------------- | ------------------------ | --------------------------------------------- |
| L1    | The claim of the moment         | Largest       | Whole module duration    | "47 KILLED IN KHAN YOUNIS", "FED HOLDS 4.50%" |
| L2    | The qualifier                   | Medium        | Whole module duration    | "Sunday — most in 24h since Mar 7"            |
| L3    | Attribution / source            | Smallest      | Bottom-anchored, persistent | "ICRC · UN OCHA"                            |

### Hard rules
- **One L1 per module.** Never two competing claims on the same frame.
- **L1 must be a fact**, not an opinion or a question.
- **L1 may not exceed 7 words** for hook/stakes, 10 words for evidence.
- **L3 is mandatory** for any module with `kind: "evidence"` or `kind: "quote"`.
- **No more than 2 levels visible at once.** L1 alone, or L1+L2, or L1+L3.
  L1+L2+L3 simultaneously is overload.
- **Numbers stay numerals.** "47" not "forty-seven". Units always present
  ("$8.4B", "4.50%", "165 WPM").
- **Proper nouns are not abbreviated** unless the abbreviation is more
  recognisable than the full name (`FED`, `EPA`, `NATO` ok; `B.O.E.` not).

### Per-kind caps
| `kind`     | L1 max words | L2 max words | Total chars-on-frame cap |
| ---------- | ------------ | ------------ | ------------------------ |
| `hook`     | 7            | n/a (skip L2)| 80                       |
| `stakes`   | 7            | 10           | 110                      |
| `evidence` | 10           | 12           | 140                      |
| `quote`    | 14           | 8            | 130                      |
| `map`      | 5 (place)    | 8            | 90                       |
| `close`    | 9            | 10           | 120                      |

If your text exceeds the cap, the failure class is `render/overflow` —
shorten the script before adjusting the plan.

---

## 4. Visual safety rules

Asset choice is the single biggest source of post-render regressions.
Default conservative; promote to richer assets only when sourcing earns it.

### Asset hint policy

- **`mute`** — the safe default. The renderer leaves the frame to text.
  Use when in doubt.
- **`data`** — only when the module asserts a number that is in
  `numeric_facts`. The renderer expects a numeric_fact_ref.
- **`map`** — only when:
  - `01_understanding.where` has at least one place name, AND
  - the module's claim is geographically specific (not "in Asia").
  Maps must be labelled. An unlabelled map is a `render/missing-asset`.
- **`photo`** — only when `02_evidence` references an image source. Never
  invent a photo. Never use stock that implies a specific person, place,
  or event. If the only available image is generic stock of a building or
  a flag, use `mute` instead.

### Hard prohibitions
- **No graphic imagery.** Conflict stories never use `photo` for casualty
  modules. Default to `map` or `data`.
- **No deepfake-like AI imagery of real people.** Period.
- **No imagery that implies a specific identity not in evidence.** A
  generic protest photo over a story about a named protester is a
  blocker.
- **No flags as primary asset** when the story is about a state actor's
  action — use a map or data module. Flags imply nationhood writ large
  where a specific institution is at issue.

### Color and contrast
- L1 text contrast ratio against background: ≥ 4.5:1.
- Critical numerics (casualty figures, prices, percentages) get a
  background plate to guarantee contrast even on busy footage.
- Red is reserved for casualties / decline / negative. Never decorative.

### Faces
- Auto-zoom on a face only when the person is named in the module's `text`
  *and* the face is the subject of the claim.
- Group photos: do not crop to a single face if the person is one of many.

---

## 5. Story-type rules

The full per-type guidance lives in `video-learning/templates/<type>.json`.
The condensed version every fresh Claude memorises:

### geopolitics
- Hook anchor: *move + actor + place + time tag*.
- Stakes anchor: name a population (numbers preferred) or a deadline.
- "Officials say" is never the actor — name the agency or person.

### finance
- Hook anchor: *body + decision + magnitude*, or *price + window*.
- Numbers must include the comparator window ("up 8.4% on Tuesday — its
  largest single-day move since March").
- Markets move every day. The story is the cause or the consequence.

### conflict
- Hook anchor: *tally + place + 24h-or-shorter window*.
- Casualty figures *always* require ≥2 sources or explicit attribution.
- Asset hint defaults to `map` or `data`. `photo` is forbidden for any
  module asserting a casualty.

### policy
- Hook anchor: *body + verb + scope*. Always name the stage (proposed,
  final, struck down).
- Vote tallies must be exact and from the official source.
- Frame the rule as what it *does*, not as good/bad.

### tech
- Hook anchor: *vendor + ship/incident + delta*.
- Vendor benchmarks are not independent — name the source ("per Apple's
  M5 launch page").
- Banned: `revolutionary`, `game-changing`, `next-gen`.

If a story does not fit any existing type, *do not invent a type inline*.
Surface it as a `template_proposal` in `08_learning.json` and pick the
closest existing type for this run.

---

## 6. Anti-patterns

Concrete negative examples. If a draft matches any of these shapes,
rewrite before stage 5.

### Hooks
- ❌ "What if the Fed cuts rates next month?"
- ❌ "In a major development, Tokyo grounded flights..."
- ❌ "Could the ceasefire collapse?"
- ❌ "Big news from Brussels today."
- ✅ "Tokyo grounded all flights to Sapporo on Tuesday."
- ✅ "The Fed held rates at 4.50% for a fifth straight meeting."

### Stakes
- ❌ "The world is watching tensions rise."
- ❌ "This could affect everyone."
- ❌ "Tragic consequences are unfolding."
- ✅ "For the 18 million expats in the Gulf, ..."
- ✅ "If the Friday deadline passes, 1.4 million households lose service."

### Evidence modules
- ❌ Stacking two claims with "and": "Brent crossed $90 and OPEC+ added
  production."
- ❌ Quote module whose `text` is a paraphrase, not the verbatim quote.
- ❌ Map module over "in Asia" or "the region".
- ✅ One claim per module; split if you reach for "and".

### Closes
- ❌ "Time will tell."
- ❌ "Stay tuned for updates."
- ❌ Restating the hook in different words.
- ✅ "The next FOMC decision drops June 12."
- ✅ "Talks resume Monday in Doha; both sides have until Friday."

### Plans
- ❌ `asset_hint: "photo"` with no image source.
- ❌ Six evidence modules to cover three claims (split because the script
  was too long).
- ❌ A `quote` module before a `stakes` module.
- ✅ 3 tight evidence modules, each citing.

### Learning entries
- ❌ "The hook felt weak."
- ❌ "Be careful with numbers."
- ✅ "Hook used 'what if' construction. Banned-word list missed `what if`.
  Add `what if` to the regex in `prompts/03-voiceover-script.md`."

---

## 7. Using approved examples

Approved examples live in `video-learning/approved-examples/<story_type>/<id>/`.
They are the cheapest way to ratchet quality.

### When to read one
- **Stage 3 (script)**: skim the example's `03_script.md` *before*
  drafting. Do not copy structure verbatim — match cadence.
- **Stage 4 (plan)**: skim the example's `04_module-plan.json` for
  module count, kind ordering, asset choices.
- **Stage 5 (pre-render critique)**: required diff. Name 1–2 ways the
  current plan is *weaker* than the example. If you cannot, read more
  carefully — there is almost always a difference.
- **Stage 7 (post-render critique)**: required diff against the rendered
  example. Pacing and asset honoring are the usual gaps.

### When to promote a story to an approved example
A story qualifies as a promotion candidate when *all* of:
- `subjective_quality >= 4` in `07_post-render-critique.json`.
- It beats the current best for its type on a *named* axis (cite which).
- The renderer contract has not changed since the current best example
  was promoted (check `pinned_to_render`).

The promotion is two steps:
1. The runner emits `category: "example_promotion"` in
   `08_learning.json` with the named axis it beat the prior example on.
2. The operator (between stories) copies the named files into
   `video-learning/approved-examples/<type>/<id>/` and updates the INDEX.

### When to retire an approved example
- The renderer's module contract changes incompatibly → bump
  `pinned_to_render` and re-review.
- A newer story for the type beats it on a named axis → replace.
- The example anchors critiques toward stylistic drift → retire rather
  than rewrite. There is no rule that every type has an example.

### When you have no approved example
Use the type template (`video-learning/templates/<type>.json`) as the
diff target. Note in stage 5's `approved_example_diff: null` and
`infos[]` that this story type has no anchor yet.

---

## 8. How learning records update the system

The promotion loop is the only thing that makes the system smarter. It
runs once per story and is *deliberate* — never auto-applied.

### What happens automatically
- Stage 8 produces `08_learning.json`.
- `update_learning.py` appends every entry to `LEARNING_RECORD.md`.
- `failure` entries route to `learning/known-failure-modes.md`.
- `pattern` entries route to `learning/known-good-patterns.md`.
- `*_proposal` entries are flagged inline in `LEARNING_RECORD.md` with
  `PROPOSAL (...)` markers.

### What requires the operator (between stories)
The operator reviews proposals before they affect future stories:

| Proposal             | Promotion path                                                            |
| -------------------- | ------------------------------------------------------------------------- |
| `rule_proposal`      | Edit `playbook/video-pipeline-playbook.md` (this file). Bump version. Add changelog line. |
| `prompt_proposal`    | Edit `video-learning/prompts/0X-*.md`. No version bump (prompts evolve continuously). |
| `template_proposal`  | Edit `video-learning/templates/<type>.json` or `module-skeletons/*.md`.   |
| `example_promotion`  | Copy artifacts into `video-learning/approved-examples/<type>/<id>/`. Update INDEX. |

### Promotion rules
- **Two-strike rule**: a `failure`-class entry is only promoted to a
  global rule after it has appeared in at least two stories. One incident
  is a story problem; two is a system problem.
- **Single-strike for proposals**: a `prompt_proposal` or
  `template_proposal` can promote on first appearance — these target the
  prompt that produced the failure, not a global rule.
- **No silent rewrites**: every promotion has a corresponding line in
  `playbook/changelog.md` (or the prompt's git commit message).
- **Retire on neglect**: rules that no `LEARNING_RECORD.md` entry has
  cited in the last 50 stories are candidates for retirement at the next
  playbook revision.

### What the runner must always do
- **Always** produce `08_learning.json`, even if `outcome: "scrapped"`.
  Scrapped stories carry the most lessons.
- **Never** skip `update_learning.py`. The runner reminds the operator at
  stage 8 close.
- **Never** edit this playbook mid-flow. Propose; the operator promotes.

---

## Changelog

| Version | Date       | Change                                     |
| ------- | ---------- | ------------------------------------------ |
| 1.0.0   | 2026-05-05 | Initial playbook covering §1–§8.           |
| 1.1.0   | 2026-05-06 | Promotion sweep after story 215 (skipped — retail-deals aggregation). §1.3 expanded with three standing rules (source independence, trust-the-synth, defence-in-depth); §2 adds `sourcing/network-overlap` and `sourcing/synth-flag-ignored` failure classes. Prompt edits: stage 1 adds step-0 service-journalism early-reject; stage 2 adds gates 2a, 2b, 5, 6, 7; stage 5 adds C22 synth-flag-conflict; stage 8 adds `skipped` outcome row. Template: tech.json `fits_poorly_when` excludes affiliate-aggregation. Tools: new `lib/source_networks.py`; `lib/story_type.py` returns `service-journalism` sentinel; `prepare_story_context.py` short-circuits before workspace creation; `process_story.py` adds exit code 5; `update_learning.py` and `learning-record.schema.json` already accept `outcome: "skipped"` (landed during story 215). |
| 1.2.0   | 2026-05-09 | Operator-driven response to the cumulative 18-story `100% asset_status='placeholder'` pattern (stories 181/183/187/195/197/199/206/213/216/222). §1 adds the **Visual asset rule of thumb (HARD RULE)** — every module must display a real image (person photo, country flag, iconic concept stock, or numeric data plate); the four-step priority ladder is now the contract. §2 adds `render/visual-starvation` failure class. Synth side: `azure-functions/lib/sourceDiversity.js` collapses sister-site networks (9to5/vox/vice/conde-nast) and caps the diversity label at `narrow` on ≥75% same-author concentration; `azure-functions/lib/videoEligibility.js` adds gates `no_enriched_entities`, `single_country_outside_theatre`, and `visual_starvation`; `buildSourceDocuments` now persists `author` so video-side gate-2a can fire. Optional render-side asset-fetch ladder lands in `scripts/render-from-plan.js`. |

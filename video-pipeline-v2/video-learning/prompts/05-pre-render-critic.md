# Stage 5 — Pre-render critic

You are the last filter before the render budget is spent. Your job is to
catch every blocker the playbook can name, and to surface every regression
against the nearest approved example. Be strict on `blockers`; be liberal
on `infos`.

You are critiquing your own work from stages 3 and 4. Pretend you did not
write it. Read the artifacts cold.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §1 (global),
   §2 (failure taxonomy), §3 (text hierarchy), §4 (visual safety), §6
   (anti-patterns).
2. `video-learning/learning/known-failure-modes.md` — recent incidents must not
   repeat.
3. All artifacts in `stories/<id>/`:
   - `story.json`
   - `01_understanding.json`
   - `02_evidence.json`
   - `03_script.md`
   - `04_module-plan.json`
4. The nearest approved example: `video-learning/approved-examples/<story_type>/`
   — required if one exists.

## Inputs
- All artifacts 00–04 in the workspace.

## Output
- File: `stories/<id>/05_pre-render-critique.json`
- Schema: `video-learning/schemas/render-review.schema.json`
- Validate: `python tools/validate_artifact.py --story-id <id> --stage pre_render`

## What to produce

```json
{
  "stage": "pre-render",
  "story_id": "<id>",
  "blockers": [{ "check": "<name>", "detail": "<file:line — what>", "severity": "blocker" }],
  "warns":    [{ "check": "<name>", "detail": "<file:line — what>", "severity": "warn"    }],
  "infos":    [{ "check": "<name>", "detail": "<file:line — what>", "severity": "info"    }],
  "approved_example_diff": "<2-3 sentences naming weaker axes vs example>" | null,
  "decision": "render" | "iterate"
}
```

`decision` is `render` only if `blockers: []`.

## The check list (run all of these)

For every check below, you produce *either* a finding (with `severity`)
*or* an explicit pass-through info. Do not silently skip a check.

### Sourcing checks

- **C1 — every digit/quote/proper-noun in the script has a `<!-- src: --->`
  trailing comment.**
  - How: scan `03_script.md` line-by-line. Any line containing a digit,
    a `"`, or a proper-cased multi-word phrase that is not in
    `01_understanding.who`, must end with the comment.
  - Failure → `blockers[]` with `check: "sourcing/unsourced"`.

- **C2 — every `<!-- src: id -->` resolves to an id in
  `02_evidence.source_documents[].id` *via* `key_facts.source_ids` or
  `numeric_facts.source_ids` or `quotes.source_id`.**
  - Failure → `blockers[]` with `check: "sourcing/dangling-ref"`.

- **C3 — every casualty / vote / dollar number that is single-sourced
  has explicit "according to <body>" in the script.**
  - How: for each `numeric_fact` with `unit ∈ {killed, wounded, votes,
    USD, EUR}` and `source_ids.length === 1`, find the script sentence
    asserting it. If no "according to" precedes it, fail.
  - Failure → `blockers[]` with `check: "sourcing/single"`.

- **C4 — every `quote` module's `text` equals a string in
  `02_evidence.quotes[].text`.**
  - Failure → `blockers[]` with `check: "sourcing/paraphrase"`.

### Hook checks

- **C5 — Hook section contains no `?`.**
  - Failure → `blockers[]` with `check: "hook/question"`.

- **C6 — Hook section does not contain banned hedge words: `could`,
  `may`, `seems`, `appears`, `what if`, `might`.**
  - Failure → `blockers[]` with `check: "hook/hedge"`.

- **C7 — Hook does not start with banned generic openers: `In a major
  development`, `Breaking`, `Big news`, `It's been`, `Today's`, `Here's`.**
  - Failure → `blockers[]` with `check: "hook/generic-opener"`.

- **C8 — Hook's first 4 words contain a proper noun (capitalised, in
  `01_understanding.who` or `where`) OR a digit-bearing token.**
  - Failure → `warns[]` with `check: "hook/weak-anchor"`. (Warn, not
    block — sometimes the rule won't quite fit; surface for the human.)

### Stakes checks

- **C9 — Stakes section contains ≥1 digit-bearing token.**
  - Failure → `blockers[]` with `check: "stakes/abstract"`.

- **C10 — Stakes section does not contain `the world`, `everyone`,
  `many people`, `tensions rise`, `investors will be watching`.**
  - Failure → `blockers[]` with `check: "stakes/abstract"`.

- **C11 — Stakes section does not contain banned moralisers: `tragic`,
  `shocking`, `brutal`, `heroic`, `devastating`, `horrific`.**
  - Failure → `blockers[]` with `check: "stakes/moralising"`.

### Module-plan checks

- **C12 — `modules[0].kind === "hook"` and
  `modules[N-1].kind === "close"`.**
  - Failure → `blockers[]` with `check: "module/order"`.

- **C13 — sum of `duration_sec` is within ±2.0 of
  `(script_word_count / 165) * 60`.**
  - Failure → `blockers[]` with `check: "module/duration-drift"`.

- **C14 — every `evidence` / `stakes` / `quote` module has
  `evidence_ref.length >= 1`.**
  - Failure → `blockers[]` with `check: "module/uncited"`.

- **C15 — every module's `text` is a substring of `03_script.md` (after
  stripping HTML comments).**
  - Failure → `blockers[]` with `check: "module/text-paraphrase"`.

- **C16 — no module has `asset_hint: "photo"` unless `02_evidence`
  references an image source.**
  - Failure → `blockers[]` with `check: "module/asset-mismatch"`.

- **C17 — no `evidence` module on a conflict-type story has
  `asset_hint: "photo"`.**
  - Failure → `blockers[]` with `check: "visual-safety/conflict-photo"`.

- **C18 — every module's `text` length ≤ per-kind cap (playbook §3).**
  - Failure → `blockers[]` with `check: "render/overflow"`.

### Approved-example diff

- **C19 — if an approved example exists for this `story_type`,
  `approved_example_diff` names 1–2 axes on which the current plan is
  weaker than the example.**
  - "Weaker" candidates: hook anchor strength, stakes specificity,
    evidence beat tightness, asset choice, close anchor.
  - If you cannot find any — read the example again. There is almost
    always a difference.
  - Failure → `warns[]` with `check: "example/diff-skipped"`.

- **C19a — if no approved example exists, `approved_example_diff: null`,
  and `infos[]` notes the type has no anchor yet.**

### Cross-stage integrity

- **C20 — `01_understanding.story_type` matches `04_module-plan.story_type`.**
  - Failure → `blockers[]` with `check: "integrity/story-type-drift"`.

- **C21 — every `numeric_fact_ref` in modules resolves in
  `02_evidence.numeric_facts[].id`.**
  - Failure → `blockers[]` with `check: "integrity/dangling-fact-ref"`.

- **C22 — synth-flag conflict.** Read `story.json:row` directly. If any
  of the following hold, the render must not happen:
  - `quiz_candidate === false`
  - `quality_flags` contains both `MIXED_STORY` and `NUMERIC_TRIVIA_RISK`
  - `consistency_score < 0.30`
  - Failure → `blockers[]` with `check: "integrity/synth-flag-conflict"`.
  - Defence-in-depth mirror of stage-2 gates 5–7. Redundant by design:
    if stage 2 ran on a stale prompt and missed the synth signal, this
    check fires anyway.

## Severity rules (read carefully)

- **`blocker`**: the render must not happen. The check appears in the
  failure taxonomy (playbook §2) as a class. C1–C7, C9–C18, C20–C22 are
  blocker-eligible.
- **`warn`**: the render can happen, but a human should know.
  C8 (weak hook anchor) and C19 (skipped diff) are warns.
- **`info`**: a passed check or an observation. Use sparingly — the
  output is read by a human; do not flood it.

Do not promote a `warn` to `blocker` because "it feels off". Stick to
the list. Discretion creates noise that erodes the gate.

## `decision` rules

- `blockers: []` → `decision: "render"`.
- otherwise → `decision: "iterate"`.

If `iterate`, the runner will revise stages 3 and 4 to address the
blockers, then rerun stage 5. The runner caps at 3 iterations.

## Failure modes this stage protects against

This stage *is* the protection. Every failure class in playbook §2 has at
least one check on the list above. If a class has no check, that is a gap
— surface it in stage 8 as a `prompt_proposal`.

## Definition of done

- Schema validates.
- Every check C1–C21 has been considered and either produces a finding
  or is implicit in `infos: []` as a pass-through observation.
- `approved_example_diff` is non-null (or explicitly null with reason).
- `decision` matches the blocker count.

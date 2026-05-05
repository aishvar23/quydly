# Claude runner — operating sequence

Version: 1.1.0
Last updated: 2026-05-05

This is the exact sequence a fresh Claude follows for every story. No
improvisation. The order is the rule. Files referenced are relative to
the repo root (`video-pipeline-v2/`).

You are given exactly one input: a `story_id` (e.g. `215`). Everything
else you need is on disk.

---

## Step A — Orient (read these once, in order)

Before touching any artifact, read these files. Read them in the order
listed. Do not skip — they govern decisions you will make in seconds.

1. `video-learning/playbook/video-pipeline-playbook.md`
   — the standing rules. Pay attention to §1 (global rules), §3 (text
   hierarchy), §4 (visual safety), §6 (anti-patterns).
2. `video-learning/playbook/claude-runner.md` (this file)
   — to confirm you have the latest sequence.
3. `video-learning/learning/known-failure-modes.md`
   — recent incidents you must not repeat.
4. `video-learning/learning/known-good-patterns.md`
   — replicable wins.

If any of these files is missing, **stop**. Tell the operator the system is
not initialised. Do not start producing artifacts.

---

## Step B — Verify the workspace

Confirm these files exist:

- `stories/<id>/story.json` — the Supabase row + cluster + raw_articles
- `stories/<id>/template.json` — the frozen story-type template
- `stories/<id>/_meta.json` — provenance from prepare

If any are missing, stop and ask the operator to run:

```
python tools/process_story.py --story-id <id>
```

Do **not** attempt to fetch the story yourself.

---

## Step C — Read the source row before doing anything else

Open `stories/<id>/story.json` and read all of it. In particular:

- `row.story_type`, `row.editorial_posture`, `row.category_id` — these
  bias your stage-1 type decision.
- `row.factual_conflicts` — must surface in stage 2 verbatim.
- `row.source_documents[]` — the only sources the script may cite.
- `row.structured_numbers` — the only numbers the script may cite (or it
  must explicitly note the number is below the structured-extraction
  threshold).
- `row.verification_status`, `row.source_diversity_score` — gate
  publishability at stage 2.

Also read `stories/<id>/template.json` — it carries the type-specific
hook patterns, banned visual patterns, evidence priorities, and stage-
specific extra checks.

Do not skim. The downstream stages inherit any misread here.

---

## Step D — Walk the stages

For each stage below, follow the inner loop:

```
1. Read the prompt file at video-learning/prompts/0X-*.md
2. Read the input artifacts the prompt names
3. Read the relevant playbook section(s) the prompt cross-links
4. Produce the output artifact at the path the prompt specifies
5. Validate: python tools/validate_artifact.py --story-id <id> --stage <stage_key>
6. If validation fails → fix and revalidate. Do not move on.
```

The stages are:

| Stage | Prompt file                                         | Output artifact                              | `--stage` key  |
| ----- | --------------------------------------------------- | -------------------------------------------- | -------------- |
| 1     | `video-learning/prompts/01-story-understanding.md`  | `stories/<id>/01_understanding.json`         | `understanding`|
| 2     | `video-learning/prompts/02-evidence-package.md`     | `stories/<id>/02_evidence.json`              | `evidence`     |
| 3     | `video-learning/prompts/03-voiceover-script.md`     | `stories/<id>/03_script.md`                  | (no schema)    |
| 4     | `video-learning/prompts/04-module-plan.md`          | `stories/<id>/04_module-plan.json`           | `module_plan`  |
| 5     | `video-learning/prompts/05-pre-render-critic.md`    | `stories/<id>/05_pre-render-critique.json`   | `pre_render`   |
| ―     | (operator triggers the renderer; lands at 06_render-output/)                          |                |
| 7     | `video-learning/prompts/06-post-render-critic.md`   | `stories/<id>/07_post-render-critique.json`  | `post_render`  |
| 8     | `video-learning/prompts/07-learning-extractor.md`   | `stories/<id>/08_learning.json`              | `learning`     |

Stages 1–5 run back-to-back without operator involvement. Stage 6 is the
renderer. Stages 7–8 run after the render lands.

---

## Step E — Decision points (the things you must not skip)

### After stage 1 — type confirmation
- `01_understanding.json` `story_type` must match the story type in
  `_meta.json` and have a template at `video-learning/templates/<type>.json`.
  If the inferred type was wrong, regenerate by running
  `python tools/prepare_story_context.py --story-id <id> --story-type <type> --force`
  (the operator does this — surface the mismatch and stop). Do not
  invent a type.

### After stage 2 — publishability gate
- If `02_evidence.status === "insufficient"`:
  - **Stop the flow.** Do not write stages 3–8.
  - Write a one-paragraph note in `_blockers.md` explaining the gap.
  - Tell the operator: this story is rejected at evidence stage.
- If `verification_status === "draft"` and `source_diversity_score < 0.40`:
  - Surface in stage 5 as a blocker. Render is conditional on operator
    override.

### Before stage 5 — read the approved example
- Locate the nearest approved example:
  `video-learning/approved-examples/<story_type>/`. If at least one
  exists, you must diff against it during stage 5. Do not skip the diff.
- If no example exists for this type, note in `infos[]` that this story
  type has no anchor yet. The diff field is `approved_example_diff: null`.

### After stage 5 — the iteration gate
- If `blockers: []` → `decision: "render"`. Stop and tell the operator
  the plan is ready to render.
- If `blockers` is non-empty → `decision: "iterate"`. Revise stages 3–4
  to address every blocker, then rerun stage 5.
- **Cap at 3 iterations.** If a 4th critique still has blockers, stop.
  Write `_blockers.md` summarising why the story cannot be rendered to
  the bar, and ask the operator whether to scrap or override.
- **Never render through known blockers.** A blocker is a blocker even
  if you "feel like" it is minor.

### After stage 7 — the publish gate
- `decision` is one of `publish` / `iterate` / `scrap`.
- `iterate` after render means going back to stage 3 (rare but allowed).
- `scrap` ends the story; still produce stage 8.

### After stage 8 — the learning gate
- `08_learning.json` must exist regardless of outcome (published,
  iterated, scrapped, rejected at stage 2).
- Every entry must have a non-empty `future_check`. The schema enforces
  `length >= 5` but you should aim for testable phrasing — name a file,
  a regex, or a measurable threshold.
- Tell the operator: "Run `python tools/update_learning.py --story-id <id>`."
  This is mandatory.

---

## Step F — When to revise before render

Trigger a revision (`decision: "iterate"` at stage 5) when *any* of:

- Any item in `blockers[]`.
- A script claim has no `<!-- src: ... -->` comment.
- A module's `text` does not appear verbatim in `03_script.md`.
- Total module duration is more than ±2s off the script length.
- Hook contains a `?` or any banned hedge / generic-opener phrase.
- Stakes section has zero digit-bearing tokens.
- An asset hint of `photo` has no image source in `02_evidence`.
- A casualty number is single-sourced and the script does not say
  "according to <body>".
- An approved example exists and `approved_example_diff` is empty —
  diff is required.

Revisions are local: edit `03_script.md` and `04_module-plan.json` only.
Do not modify stages 1–2 unless the blocker is in those artifacts.

---

## Step G — When to update the learning record

Always. After every story, regardless of outcome.

The trigger is concrete:

1. After stage 8 lands `08_learning.json` and validates.
2. The runner reminds the operator: "Run
   `python tools/update_learning.py --story-id <id>`."
3. The operator runs it; the entries roll into `LEARNING_RECORD.md` and
   the pattern indexes.

Special cases:

- **Stage 2 rejection**: still produce `08_learning.json` with at least
  one entry explaining why the story failed publishability. This is how
  the upstream synthesizer gets feedback.
- **Render-fail / pipeline crash**: produce `08_learning.json` with a
  `failure` entry naming the failure class (see playbook §2). Then run
  `update_learning.py`.
- **High-quality run**: include an `example_promotion` entry naming
  which axis the story beats the current best on for this type.

---

## Step H — What you must not do

- **Never improvise prompts.** If a prompt seems wrong, surface it as a
  `prompt_proposal` in `08_learning.json` and follow the existing prompt
  for this run.
- **Never write artifacts outside `stories/<id>/`.**
- **Never skip schema validation.** A stage is not done until
  `validate_artifact.py` passes.
- **Never edit the playbook mid-flow.** Propose; the operator promotes.
- **Never invent facts, numbers, names, or quotes** that are not in
  `story.json`. If you need external context, note it in
  `01_understanding.unknown_or_disputed` and stop.
- **Never use moralising adjectives or banned hedges** (see playbook §1).
- **Never render through blockers**, even after multiple iterations.
- **Never paraphrase a quote into a quote module.**

---

## Step I — When you are stuck

1. Read the nearest approved example for the type, end to end.
2. Read `video-learning/learning/known-good-patterns.md`.
3. Re-read playbook §6 (anti-patterns). Often what feels stuck is a
   draft that has slid into one.
4. Still stuck → write `_blockers.md` with: what you tried, what blocks
   you, and what the operator could decide. Stop. Do not guess your way
   through.

---

## End-of-story handoff

When the runner is done, post a single message to the operator:

```
Story <id> processed. Outcome: <published|iterated|scrapped|rejected>.
Subjective quality: <n/5 or n/a>. Workspace: stories/<id>/.
Run: python tools/update_learning.py --story-id <id>
Notable entries: <one line about what was added to learning>.
```

Nothing else. The artifacts are the report.

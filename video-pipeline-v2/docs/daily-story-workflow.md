# Daily story workflow — operational runbook

This is the exact procedure for taking a story from a Supabase id to a
published video and a learning record. Worked example throughout: story
**215**.

If you only need to remember one phrase, in a Claude Code session
opened inside `video-pipeline-v2/`:

```
process story 215
```

Claude reads `CLAUDE.md`, runs the setup script if the workspace isn't
there yet, walks stages 1–5, stops for your render, then runs stages
7–8 and the learning roll-up itself. Two messages from you, total: the
trigger phrase, and "the render is done" once you've kicked off the
renderer.

The rest of this doc walks through what happens at each step, what
artifacts to expect, and where to look when something goes wrong. It's
also the manual recipe — every command Claude runs, you can run
yourself when you need to (CI, batch, or claude.ai web sessions where
`CLAUDE.md` doesn't auto-load).

---

## 0. One-time setup

You only do this once per machine.

```bash
# Python deps for tools/
pip install -r tools/requirements.txt

# Supabase credentials. Copy and fill in.
cp .env.example .env
# Edit .env — fill in:
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_SERVICE_KEY=<service_role secret, NOT the anon key>
```

Verify the env is wired:

```bash
python tools/fetch_story.py --story-id 215 | jq .row.headline
```

If you see a headline, you're good. If you see a config error, the
`.env` isn't loading — re-check the file is at the repo root and the
keys match `.env.example` exactly.

---

## 1. Prepare the story context

```bash
python tools/process_story.py --story-id 215
```

This single command does four things:

1. Fetches story 215 from Supabase (story row + cluster + raw_articles).
2. Creates `stories/215/`.
3. Writes `stories/215/story.json`, `stories/215/template.json`,
   `stories/215/_meta.json`.
4. Prints the runner block to paste into a fresh Claude session.

### Expected output

```
[process] setup ok — story_type=geopolitics

========================================================================
 Workspace is ready. Open a fresh Claude session and paste:
========================================================================

You are processing story 215 through the video pipeline.

Read the runner instructions and follow them in order:
  video-learning/playbook/claude-runner.md

Workspace: stories/215
  - story.json   — full Supabase row + cluster + raw_articles
  - template.json — frozen story-type template
  - _meta.json    — provenance and paths

Inferred story_type: geopolitics
Template: template found: geopolitics.json

Prompts (one per stage): video-learning/prompts

Start at stage 1 (01-story-understanding.md). Stop after stage 5
and report the pre-render critique to the operator.
```

### What got created on disk

```
stories/215/
├── story.json        # Supabase row + cluster + raw_articles + fetched_at
├── template.json     # frozen snapshot of video-learning/templates/<type>.json
└── _meta.json        # provenance: created_at, story_type, template_version, paths
```

### When inference fails

If the script exits with `story_type could not be inferred`, the
deterministic rules in `tools/lib/story_type.py` did not match. Re-run
with an explicit type:

```bash
python tools/process_story.py --story-id 215 --story-type finance
```

Pick from: `legal-scandal`, `geopolitics`, `finance`, `conflict`,
`policy`, `tech`. If you find yourself overriding a lot for similar
stories, extend `lib/story_type.py` with the rule that should have
fired — that's the durable fix.

### When to use `--reuse`

If you've already prepared a workspace and just want the runner block
again (e.g., the previous session got cleared):

```bash
python tools/process_story.py --story-id 215 --reuse
```

This skips the Supabase fetch and re-prints the paste block.

---

## 2. Open a fresh Claude session

Open Claude Code (or claude.ai) in a fresh context. Paste the block
that `process_story.py` printed verbatim. Claude reads
`video-learning/playbook/claude-runner.md` and starts walking the
workflow.

You do not write any further prompts. The runner and the seven stage
prompts under `video-learning/prompts/` carry the entire instruction set.

If Claude asks clarifying questions before reading the runner — that's a
sign the context loaded incorrectly. Tell it to read
`video-learning/playbook/claude-runner.md` first; it should not need
anything else.

---

## 3. Stages 1–5 — Claude works, you watch the workspace

Claude produces five artifacts in sequence. Each validates against its
schema before the next stage starts.

### After stage 1

```
stories/215/
├── story.json
├── template.json
├── _meta.json
└── 01_understanding.json    ← new
```

**What to spot-check** (30 seconds):

```bash
jq '.story_type, .core_claim, .who, .where' stories/215/01_understanding.json
```

- Is `story_type` what you expected? (Should match `_meta.json`.)
- Is `core_claim` one declarative sentence with no hedge words?
- Are `who` entries proper-cased actors (not "officials" or "sources")?
- Is `unknown_or_disputed` honest? An empty array on a contested story
  is a yellow flag — read `story.row.factual_conflicts` and confirm.

If anything looks wrong here, **stop now**. Stage 1 mistakes propagate.
Tell Claude what's off; let it revise stage 1 before continuing.

### After stage 2

```
stories/215/
├── ...
└── 02_evidence.json         ← new
```

**Decision point: publishability gate.**

```bash
jq '.status, .reason // "n/a"' stories/215/02_evidence.json
```

- `status: "ok"` → flow continues to stage 3.
- `status: "insufficient"` → flow stops here. A `_blockers.md` will
  appear in the workspace explaining why. Decide: scrap, or override.
  Override means re-running stage 2 with explicit operator-supplied
  context (rare; only when the synth missed something you can verify
  yourself).

If `status: "ok"`, also spot-check:

```bash
jq '.key_facts | length, .numeric_facts | length, .quotes | length' stories/215/02_evidence.json
```

- 5–10 key_facts is typical
- 0+ numeric_facts (every figure has unit + as_of)
- 0+ quotes (verbatim only — empty is fine)

### After stage 3

```
stories/215/
├── ...
└── 03_script.md             ← new
```

**What to spot-check** (60 seconds — read it once aloud):

```bash
cat stories/215/03_script.md
```

- Word count: 140–250.
- Hook section contains no `?`, no `could`/`may`/`what if`.
- Stakes section contains at least one digit-bearing token.
- Every numeric / quoted line ends with `<!-- src: doc-... -->`.
- Read aloud — does it sound like spoken news, or like prose?

A weak draft script here is the cheapest place to catch problems. If
something is off, ask Claude to revise stage 3 (it will rerun stage 4
and 5 too).

### After stage 4

```
stories/215/
├── ...
└── 04_module-plan.json      ← new
```

```bash
jq '.total_duration_sec, [.modules[].kind]' stories/215/04_module-plan.json
```

- `total_duration_sec` ≈ word_count / 165 × 60 (within ±2s).
- `[.modules[].kind]` first is `"hook"`, last is `"close"`, the rest
  are `evidence`/`stakes`/`quote`/`map`.
- Module count: 4–7.

### After stage 5

```
stories/215/
├── ...
└── 05_pre-render-critique.json    ← new
```

**Decision point: render or iterate.**

```bash
jq '.decision, .blockers | length, .warns | length' stories/215/05_pre-render-critique.json
```

- `decision: "render"` and `blockers: 0` → proceed to step 4 (render).
- `decision: "iterate"` → Claude will revise stages 3 and 4, rerun
  stage 5. The runner caps at 3 iterations. If it loops, ask Claude to
  write `_blockers.md` and stop; you decide whether to override or
  scrap.

Read the warns even when the decision is `render` — they are real
signals that won't stop the render but should be remembered for
post-render review.

---

## 4. Trigger the render

The render is run by the existing pipeline (Node-based). The renderer
consumes `stories/215/04_module-plan.json` and writes its output into
`stories/215/06_render-output/`.

Exact command depends on how you've wired the renderer; the integration
point is `04_module-plan.json` in, `06_render-output/{render.mp4,
manifest.json}` out.

```bash
# Example — adapt to your renderer's entry point.
node scripts/render-from-plan.js --plan stories/215/04_module-plan.json \
                                 --out stories/215/06_render-output
```

After the render lands:

```
stories/215/
├── ...
└── 06_render-output/
    ├── render.mp4           ← the video
    └── manifest.json        ← per-module render report
```

**What to spot-check** before resuming Claude:

- `manifest.json` has one entry per module in the plan.
- `render.mp4` plays end-to-end and is roughly the expected length.
- Every module entry has `asset_status: "ok"` (placeholders / fallbacks
  show up as warns at stage 7; many fallbacks suggest a stage-4 problem).

---

## 5. Stages 7–8 — Claude resumes

Tell Claude in the same session:

> The render is done. Output is in `stories/215/06_render-output/`.
> Run stages 7 and 8.

If you can play the MP4 yourself, watch it once and paste a 2–3 line
description into the chat. If you cannot, tell Claude that — it will
rely on `manifest.json` plus the description you gave.

### After stage 7

```
stories/215/
├── ...
└── 07_post-render-critique.json    ← new
```

**Decision point: publish, iterate, or scrap.**

```bash
jq '.decision, .subjective_quality, .subjective_quality_reason' stories/215/07_post-render-critique.json
```

- `decision: "publish"` and `subjective_quality: 4` or `5` → ship it.
- `decision: "iterate"` (any post-render blocker, or quality=3) →
  return to stage 3, fix the named issue, re-render. Track which axis
  forced the iteration.
- `decision: "scrap"` (quality 1–2) → end the story; still produce
  stage 8.

Read the `module_findings[]` block — it tells you which module
renders surprised the plan (drift, asset fallback, mid-word cut).

### After stage 8

```
stories/215/
├── ...
└── 08_learning.json         ← new
```

This is the file the system learns from. Look at the entries before
running update_learning:

```bash
jq '.outcome, [.entries[] | {category, summary}]' stories/215/08_learning.json
```

You should see a mix of categories. A `published` outcome typically has
1–3 `pattern` entries (replicable wins), 0–1 `prompt_proposal` (a check
that fired wrongly or missed something), and possibly an
`example_promotion` if the story beat the current best for its type.

---

## 6. Roll learning into the index

```bash
python tools/update_learning.py --story-id 215
```

What this does:

1. Validates that the workspace has the artifacts the outcome implies.
2. Appends a per-story section to
   `video-learning/learning/LEARNING_RECORD.md`.
3. Routes `failure` entries into
   `video-learning/learning/known-failure-modes.md`.
4. Routes `pattern` entries into
   `video-learning/learning/known-good-patterns.md`.
5. Prints a "files to patch" report from any `*_proposal` entries.

### Expected output

```
[update_learning] rolled 4 entries from stories/215/08_learning.json
[update_learning] record: video-learning/learning/LEARNING_RECORD.md

Files to patch (operator review, between stories):
  PROMPTS — video-learning/prompts/0X-*.md
    - Stage-5 check C8 ('hook/weak-anchor') flagged a warn even though...
  APPROVED EXAMPLES — promote this story's artifacts
    - First geopolitics story to ship at quality 4. Beats the type's...
```

The proposals are **flagged**, not applied. You decide what to promote.

---

## 7. Between stories — promote proposals

Do this in batches (every 3–5 stories), not after every run. Look at
the `LEARNING_RECORD.md` `PROPOSAL (...)` markers since the last
promotion sweep:

```bash
grep -n 'PROPOSAL' video-learning/learning/LEARNING_RECORD.md | tail -30
```

For each proposal, decide: promote, defer, or reject.

| Proposal kind        | If you promote, edit                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `rule_proposal`      | `video-learning/playbook/video-pipeline-playbook.md`. Bump version. Add a line to the changelog at the bottom. |
| `prompt_proposal`    | `video-learning/prompts/0X-*.md`. No version bump (prompts evolve continuously). The git commit message is the changelog. |
| `template_proposal`  | `video-learning/templates/<type>.json`. Bump the template's `version` field. |
| `example_promotion`  | Copy `03_script.md`, `04_module-plan.json`, `06_render-output/render.mp4` (if small), `07_post-render-critique.json` into `video-learning/approved-examples/<type>/<story_id>/`. Add a row to `video-learning/approved-examples/INDEX.md` with the named axis the story beat the prior best on. |

The two-strike rule applies: a `rule_proposal` should only be promoted
on the second occurrence of the same class (check `links[]` and
`known-failure-modes.md` for the prior incident). First occurrences are
prompt-level fixes.

After a promotion, the next fresh Claude session reads the updated
files automatically — no other plumbing to update.

---

## 8. How the system improves

The promotion loop is the only mechanism. Everything else is mechanical.

```
┌─────────────────────────────────────────────────────────────┐
│  story N processed (stages 1–8)                             │
│       │                                                     │
│       ├─ 08_learning.json  (entries)                        │
│       │                                                     │
│       └─ tools/update_learning.py                           │
│            ├─ append → LEARNING_RECORD.md                   │
│            ├─ route 'failure' → known-failure-modes.md      │
│            ├─ route 'pattern' → known-good-patterns.md      │
│            └─ print 'files to patch' report (proposals)     │
│                                                             │
│   ┌── operator review (between stories) ──┐                 │
│   │                                       │                 │
│   ├─ promote rule_proposal     →  playbook                  │
│   ├─ promote prompt_proposal   →  prompts                   │
│   ├─ promote template_proposal →  templates                 │
│   └─ promote example_promotion →  approved-examples         │
│                                                             │
│  story N+1 fresh Claude reads the updated files             │
│       │                                                     │
│       └─ same workflow, tighter checks, better anchors     │
└─────────────────────────────────────────────────────────────┘
```

Concretely, here's what gets better and how to measure it:

- **`known-failure-modes.md` grows, then plateaus.** A repeating class
  is the trigger to promote a stage-5 check or a global rule. Once
  promoted, the class should not recur.
- **Prompts tighten incrementally.** Most learning lands as
  `prompt_proposal` entries — one or two checks added per story for
  the first 10–20 stories, then it slows.
- **Approved examples accumulate by type.** First story per type to
  hit quality 4 becomes the anchor; later quality-4+ stories that beat
  it on a named axis replace it. Stage 5's `approved_example_diff`
  becomes more substantive as anchors strengthen.
- **Subjective quality trends up.** Plot
  `[.subjective_quality]` from each `LEARNING_RECORD.md` section
  against story id. It is not monotonic — story difficulty varies —
  but the moving average of the last 10 stories should rise then
  plateau.

If the trend stalls, the usual culprit is *unpromoted proposals* —
look at `LEARNING_RECORD.md` for `PROPOSAL` markers older than
~5 stories. Either promote or reject; sitting on them blocks the loop.

---

## 9. Troubleshooting

### "supabase config: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set"
`.env` isn't loading. Confirm the file is at the repo root
(`video-pipeline-v2/.env`), not under `tools/`. Confirm both keys are
non-empty. Run `python tools/fetch_story.py --story-id 1` to test.

### "story 215 not found"
The id doesn't exist in your Supabase `stories` table. Verify with the
Supabase table editor or:

```bash
python tools/fetch_story.py --story-id 215 | jq .row.id
```

### "story_type could not be inferred"
The deterministic rules in `tools/lib/story_type.py` didn't match. Run
with `--story-type <type>` to override for this run. If similar shapes
keep failing, extend the rule set.

### Claude wrote a stage artifact that fails validation
Re-prompt: "The artifact at `stories/215/0N_*.json` failed validation.
Re-read the schema at `video-learning/schemas/...schema.json` and the
prompt at `video-learning/prompts/0N-*.md`, then fix it."

The schema's error message names the field; that's where the fix goes.

### Stage 5 keeps flagging blockers across iterations
After 3 iterations the runner stops automatically. Read `_blockers.md`
in the workspace — it explains why the story can't be rendered to the
bar. Two paths:

- The blockers are real → scrap. Outcome `scrapped`. Stage 8 still
  produces a learning record, which is where the upstream synthesizer
  gets feedback.
- The blockers are spurious (a check that's too strict) → don't
  override quietly; write a `prompt_proposal` in stage 8 explaining
  exactly which check fired wrongly and what would catch the real
  case. Then make a one-off operator override decision for this story.

### Renderer produced placeholders / fallbacks
`manifest.json` will show `asset_status` other than `"ok"`. Stage 7
catches and logs these. Common causes: `asset_hint: "photo"` with no
image source (stage-5 C16 should have caught this — file a
`prompt_proposal`), or a `map` module without a labelable place name
(extend stage-5 C19 or the type template).

---

## Quick reference card

```bash
# Setup
pip install -r tools/requirements.txt
cp .env.example .env                                      # then fill in

# Process a story
python tools/process_story.py --story-id 215              # one command
python tools/process_story.py --story-id 215 --reuse      # if workspace exists
python tools/process_story.py --story-id 215 --check      # CI / batch verify

# After Claude does its work
node scripts/render-from-plan.js --plan stories/215/04_module-plan.json \
                                 --out stories/215/06_render-output
python tools/update_learning.py --story-id 215            # roll learning

# Validate any stage at any time
python tools/validate_artifact.py --story-id 215                          # all
python tools/validate_artifact.py --story-id 215 --stage evidence         # one
```

```
Decision points (in order):
  After stage 2  →  status="insufficient"?  scrap or override
  After stage 5  →  decision="iterate"?     fix and rerun
  After stage 7  →  decision=?              publish | iterate | scrap
  After stage 8  →  proposals?              promote between stories
```

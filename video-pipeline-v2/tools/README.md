# tools/ — Python tooling for the video pipeline

Four scripts that handle the deterministic parts of the workflow:
fetch from Supabase, prepare a story workspace, orchestrate the
hand-off to Claude, and roll learning entries into the system index.

These scripts do **not** call the LLM. The intelligence lives in the
prompts under `video-learning/prompts/`, executed by Claude in a fresh
session. The scripts handle setup, verification, and roll-up.

## Setup

```bash
# One-time
pip install -r tools/requirements.txt

# Copy the env template and fill in your Supabase credentials.
cp .env.example .env
# Edit .env — see SUPABASE_URL and SUPABASE_SERVICE_KEY below.
```

### Required env vars

| Var                    | What                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| `SUPABASE_URL`         | Project URL, e.g. `https://abc.supabase.co`                         |
| `SUPABASE_SERVICE_KEY` | Service-role key (RLS bypass). **Never** put this in client bundles |

Both are required. Other repo-level vars (`ANTHROPIC_API_KEY`, `MAPBOX_TOKEN`,
`ELEVENLABS_API_KEY`) are not used by `tools/` — they belong to the render
side.

## The four scripts

### 1. `fetch_story.py`

Fetches a single story by id and emits JSON.

```bash
# Print JSON to stdout
python tools/fetch_story.py --story-id 215

# Write to a file
python tools/fetch_story.py --story-id 215 --out story-215.json

# Pipe into jq
python tools/fetch_story.py --story-id 215 | jq .row.headline
```

Output shape:

```json
{
  "row":          { "id": 215, "headline": "...", ... },
  "cluster":      { ... or null },
  "raw_articles": [ ... rows by authority_score desc ... ],
  "fetched_at":   "2026-05-05T18:30:00+00:00"
}
```

### 2. `prepare_story_context.py`

Creates `stories/<story_id>/`, drops in `story.json`, infers the story
type, and copies the matching template into the workspace as
`template.json`. Idempotent.

```bash
# First time
python tools/prepare_story_context.py --story-id 215

# When inference returns 'unknown' or you want to override
python tools/prepare_story_context.py --story-id 215 --story-type finance

# Re-fetch and overwrite (use with care — discards manual edits)
python tools/prepare_story_context.py --story-id 215 --force
```

After it runs, the workspace looks like:

```
stories/215/
├── story.json        # full Supabase row + cluster + raw_articles
├── template.json     # frozen story-type template at fetch time
└── _meta.json        # provenance — when fetched, type, paths
```

The template is **copied** rather than symlinked so each story is frozen
against the template version it was built with. If the operator later
tightens the template, this story's frozen copy still reflects the rules
that were in force when it was prepared.

### 3. `process_story.py`

The one command per story. Sets up the workspace if needed, then prints
the runner block to paste into a fresh Claude session.

```bash
# Standard flow
python tools/process_story.py --story-id 215

# Re-print the runner block without re-fetching
python tools/process_story.py --story-id 215 --reuse

# Verify a workspace is complete (CI / batch use)
python tools/process_story.py --story-id 215 --check
```

The runner block names the workspace, the inferred story type, the
runner instructions file (`video-learning/playbook/claude-runner.md`),
and the prompts directory. Claude follows the runner from there.

### 4. `update_learning.py`

After Claude produces `08_learning.json` for a story, this rolls it into
the system index.

```bash
# By story id
python tools/update_learning.py --story-id 215

# By folder (useful for workspaces outside stories/<id>/)
python tools/update_learning.py --story-folder /tmp/scratch-story-215
```

What it writes (lazy-created):

```
video-learning/learning/
├── LEARNING_RECORD.md         # append-only journal (all entries)
├── known-failure-modes.md     # only `failure`-class entries
└── known-good-patterns.md     # only `pattern`-class entries
```

It also prints a "files to patch" report when `08_learning.json` carries
proposal entries:

```
Files to patch (operator review, between stories):
  PROMPTS — video-learning/prompts/0X-*.md
    - Hook used 'what if' construction. Add to banned-hedge regex...
  APPROVED EXAMPLES — promote this story's artifacts
    - Beats current best for finance on stakes specificity...
```

Proposals are **never auto-applied**. The operator promotes them between
stories, deliberately.

## Day-in-the-life: story 215

```bash
# Step 1 — operator sets up
python tools/process_story.py --story-id 215
# → fetches, creates stories/215/, prints the runner block

# Step 2 — operator opens fresh Claude session, pastes the block
# Claude reads video-learning/playbook/claude-runner.md and walks
# stages 1–5, writing artifacts into stories/215/

# Step 3 — operator triggers the renderer (existing pipeline)
# Render output lands at stories/215/06_render-output/

# Step 4 — Claude resumes, runs stages 7 and 8

# Step 5 — operator rolls learning
python tools/update_learning.py --story-id 215
# → updates the learning files; prints the patch report

# Step 6 — operator promotes any proposals between stories
```

## Exit codes

Every script uses the same convention so they compose well in shell
scripts and CI:

| Code | Meaning                                     |
| ---- | ------------------------------------------- |
| 0    | Success                                     |
| 1    | Setup error (env, supabase config, fs)      |
| 2    | Story id not found                          |
| 3    | Unexpected error / malformed artifact       |
| 4    | Operator decision needed (e.g. story_type)  |

## Layout

```
tools/
├── fetch_story.py            # 1 — fetch by id
├── prepare_story_context.py  # 2 — workspace + template snapshot
├── process_story.py          # 3 — high-level orchestrator
├── update_learning.py        # 4 — roll learning into index
├── requirements.txt
├── README.md                 # (this file)
└── lib/
    ├── supabase_client.py    # cached supabase-py client + env handling
    ├── paths.py              # canonical path helpers (one place to edit)
    └── story_type.py         # deterministic story_type inference
```

## Why pure Python (not Node)

The render pipeline is Node and has its own Supabase integration at
`src/integrations/supabase.js`. The tooling here intentionally does not
go through that path — for the learning side we want a self-contained
Python toolchain that doesn't fail on Node version drift. A `select *`
on the row means we don't have to mirror the JS column list either; the
prompts pick what they need from the row.

## Common issues

- **`SUPABASE_URL and SUPABASE_SERVICE_KEY must be set`** — copy
  `.env.example` to `.env` and fill in the values. The service key is in
  the Supabase project's Settings → API → `service_role` (not `anon`).
- **`story <id> not found`** — verify the id in the Supabase table
  editor, or via `python tools/fetch_story.py --story-id <id> | jq .row.id`.
- **`story_type could not be inferred`** — re-run with
  `--story-type <type>`, or extend `tools/lib/story_type.py` to add the
  rule that should have fired. Adding a rule is the right answer if the
  same shape will repeat; `--story-type` is the right answer for a
  one-off.

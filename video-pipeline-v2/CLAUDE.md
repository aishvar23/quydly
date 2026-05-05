# video-pipeline-v2 — Claude Code project file

## Trigger phrase: "process story <id>"

When the user's message matches `process story <id>` (or `process <id>`,
`run story <id>`, `do story <id>`), treat it as a request to walk
story `<id>` through the video pipeline. Do this:

1. Check whether `stories/<id>/story.json` exists.
   - If it does, skip to step 2.
   - If it doesn't, run:
     ```
     python tools/process_story.py --story-id <id>
     ```
     This fetches the row from Supabase and creates the workspace.
     If the script exits non-zero, report the stderr to the user and
     stop — do not try to recover. Common cases:
     - Exit 1 (Supabase config): user needs to fill in `.env`.
     - Exit 2 (story not found): user gave a bad id.
     - Exit 4 (story_type unknown): tell the user to re-run with
       `--story-type <type>` (one of legal-scandal / geopolitics /
       finance / conflict / policy / tech).
2. Read `video-learning/playbook/claude-runner.md` and follow it
   exactly. It tells you which files to read, in what order, and where
   to write artifacts.
3. The standing rules are in
   `video-learning/playbook/video-pipeline-playbook.md`. The runner
   tells you when to consult them.
4. Stop after stage 5 and report the pre-render critique. Do not
   continue to render.
5. When the user later says the render is done, run stages 7 and 8.
6. After stage 8 lands `08_learning.json`, run:
   ```
   python tools/update_learning.py --story-id <id>
   ```
   Report its "files to patch" output (if any) to the user.

Do not improvise prompts. Do not ask clarifying questions before
reading the runner.

## What this project is

`video-pipeline-v2/` is the v2 video pipeline plus the operating system
around it. The system has three top-level pieces:

- `video-learning/` — the system brain (playbook, prompts, templates,
  schemas, learning index, approved examples). What carries forward
  between fresh Claude sessions.
- `tools/` — Python CLI for fetch / prepare / process / validate /
  update_learning.
- `stories/<id>/` — one folder per story, holding every artifact stages
  1–8 produce.

Full operator guide: `docs/daily-story-workflow.md`.

## Working rules (for any task in this project)

- Never write artifacts outside `stories/<id>/` when processing a story.
- Never edit `video-learning/playbook/*` mid-story. Propose changes via
  `08_learning.json` instead; the operator promotes between stories.
- Run `python tools/validate_artifact.py --story-id <id> --stage <key>`
  after every JSON-producing stage.

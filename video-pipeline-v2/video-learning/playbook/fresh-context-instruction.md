# Fresh-context Claude instruction

## Shortest form (Claude Code only)

If you're in a Claude Code session opened from inside `video-pipeline-v2/`,
the project's `CLAUDE.md` is auto-loaded and recognises the trigger
phrase. One line is enough:

```
process story 215
```

(or `process 215`, `run story 215`, `do story 215` — they all work.)

Claude itself runs `python tools/process_story.py --story-id 215` if
the workspace isn't already set up, walks stages 1–5, stops for your
render, then runs stages 7–8 and `python tools/update_learning.py`
when the render is done. You send two messages total: the trigger
phrase, and "the render is done" later. Use this as your default.

## Full paste block (claude.ai web, or any context where CLAUDE.md isn't loaded)

Use this when the project `CLAUDE.md` isn't in scope — e.g., a fresh
claude.ai web session, or a Claude Code session opened above the
project root. Replace `<id>` with the story id.

`tools/process_story.py` prints this same block automatically — you
typically don't need to copy from here.

---

## Template

```
You are processing story <id> through the video pipeline. The workspace
is at stories/<id>/.

Follow video-learning/playbook/claude-runner.md exactly. It will tell
you which files to read, in what order, and where to write artifacts.
The standing rules are in video-learning/playbook/video-pipeline-playbook.md.

Do not improvise prompts. Stop after stage 5 and report the pre-render
critique to me.
```

That's the whole thing. No further instruction needed. The runner walks
Claude through orient → verify workspace → read source row → stages 1–5,
and stops on its own.

---

## Example — story 215

```
You are processing story 215 through the video pipeline. The workspace
is at stories/215/.

Follow video-learning/playbook/claude-runner.md exactly. It will tell
you which files to read, in what order, and where to write artifacts.
The standing rules are in video-learning/playbook/video-pipeline-playbook.md.

Do not improvise prompts. Stop after stage 5 and report the pre-render
critique to me.
```

After you send this, Claude reads the runner, then the playbook, then
the failure-modes and good-patterns files, then begins stage 1. Five
artifacts later (`01_understanding.json` through
`05_pre-render-critique.json`) it stops and reports.

You then trigger the renderer; once `06_render-output/` is populated,
say:

> The render is done. Output is in `stories/215/06_render-output/`.
> Run stages 7 and 8.

That's the second and final instruction you ever need to send.

---

## What this paste block deliberately does *not* include

- Explanations of what the workflow does. The runner has them.
- A list of artifacts to produce. The runner has them.
- Quality rules. The playbook has them.
- The failure modes to avoid. `known-failure-modes.md` has them, and
  the runner tells Claude to read it.

If you find yourself adding instructions to the paste block, that means
the runner / playbook / prompts are missing something. Fix those, not
this. The whole point of the system is that fresh Claude only ever
needs the story id and this paste block.

---

## When Claude doesn't follow

Two recovery moves, in order:

1. "Read `video-learning/playbook/claude-runner.md` first, then
   continue." — covers the case where Claude started producing
   artifacts before reading the orient files.
2. "The artifact at `stories/215/0N_*.json` failed validation. Re-read
   the schema at `video-learning/schemas/...schema.json` and the prompt
   at `video-learning/prompts/0N-*.md`, then fix it." — covers the case
   where Claude wrote something the schema rejects.

If you find yourself sending a third recovery instruction, that's a
signal to file a `prompt_proposal` at stage 8 — the prompt is letting
Claude drift in a way the system should catch.

# How fresh context works

The system is designed so each story starts in a fresh Claude session yet
benefits from every prior story. Here is how.

## What does *not* carry forward

- Chat memory between sessions
- Anything Claude "learned" in a previous run that wasn't written to a file
- The operator's own recall of prior decisions

## What *does* carry forward

The runner reads these files at the start of every story:

| File                                                  | What it carries                          |
| ----------------------------------------------------- | ---------------------------------------- |
| `video-learning/playbook/video-pipeline-playbook.md`  | Current rules — only the top of the file |
| `video-learning/playbook/claude-runner.md`            | The operating sequence                   |
| `video-learning/learning/known-failure-modes.md`      | Things that have gone wrong              |
| `video-learning/learning/known-good-patterns.md`      | Things that have worked                  |
| `video-learning/prompts/0X-*.md` (per stage)          | The prompt for that stage                |
| `video-learning/templates/<type>.json`                | Type-specific guidance (story-type)      |
| `video-learning/templates/module-skeletons/*.md`      | Renderer-contract reminders (per kind)   |
| `video-learning/approved-examples/<type>/...`         | Concrete gold standards                  |

## The promotion loop

The thing that makes the system smarter is the promotion loop:

```
story → stage 8 produces 08_learning.json
      → tools/update_learning.py rolls entries into LEARNING_RECORD.md
      → update_learning routes failures/patterns into the indexes
      → operator promotes meaningful entries between stories:
          - rule_proposal     → video-learning/playbook/video-pipeline-playbook.md
          - prompt_proposal   → video-learning/prompts/0X-*.md
          - template_proposal → video-learning/templates/...
          - example_promotion → video-learning/approved-examples/<type>/...
      → next story's fresh Claude reads the updated files
```

The "between stories" pause is deliberate: it forces a human review before a
single failed story rewrites a global rule.

## Why this works without chat memory

1. The runner instructions are short enough that a fresh Claude reads them
   in seconds.
2. Every artifact is on disk, validated, and named by stage. Claude can
   resume mid-flow simply by reading what is already in the workspace.
3. Improvements live in the same files Claude reads on the next run, so
   "the model gets smarter" reduces to "the operator promotes proposals".
4. Approved examples are concrete, copy-able patterns — the cheapest way
   to ratchet quality.

## What can go wrong

- **Memory drift in playbook**: rules accumulate without retiring old ones.
  Fix: the playbook is short on purpose; if it grows past ~100 lines of
  rules, prune.
- **Failure modes that nobody promotes**: entries land in
  `known-failure-modes.md` but no decision rule references them. Fix: the
  operator's between-stories review owns this.
- **Approved examples that go stale**: the renderer changes but old
  examples still anchor critique. Fix: examples carry a `pinned_to_render`
  field in their INDEX entry; bump it deliberately.

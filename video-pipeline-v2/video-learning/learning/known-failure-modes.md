# Known failure modes

Each entry: `[<date> story <id>] <one-line failure> — check: <future test>`.
Read by every fresh Claude before stage 1 and stage 5. Append-only.

When a failure repeats, add a decision rule in
`video-learning/playbook/video-pipeline-playbook.md` referencing the
entries that caused it.

## Seed entries (carried over from prior pipeline work)

- [seed] Synthesizer-side weakness presents as empty extractor outputs in
  `02_evidence.json` (numeric_facts/quotes empty even though the story has
  numbers in `summary`/`key_points`). — check: stage 2 must compare the
  *count* of `structured_numbers`/`primary_entities_enriched` from
  `story.row` against the count surfaced in `02_evidence`. A drop ≥50% is
  a blocker for stage 2.
- [seed] Hook written as a question or hedged assertion. — check: stage 5
  must scan `03_script.md`'s Hook section for question marks and the banned
  word list (`could`, `may`, `seems`, `appears`, `what if`).
- [seed] Single-sourced casualty figure rendered without attribution. —
  check: stage 5 must verify any conflict-type story with a casualty
  number has either ≥2 source_ids or an explicit "according to <body>" in
  the script.
- [seed] Stakes line uses generic populations ("the world", "everyone"). —
  check: stage 5 scans `03_script.md`'s Stakes section for those literal
  phrases and rejects.

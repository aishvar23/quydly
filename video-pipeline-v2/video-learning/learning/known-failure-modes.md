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
- [2026-05-06 story 215] Stage 2 cleared a story that the synthesizer itself had already flagged as weak (quality_flags=['MIXED_STORY','NUMERIC_TRIVIA_RISK'], quiz_candidate=false, consistency_score=0.125, editorial_posture='disclosure_official'). The four publishability gates only read source counts, domain roots, verification_status, and casualty attribution — none of them inspect the synth's own quality fields. — check: Add stage-2 gate-5 in video-learning/prompts/02-evidence-package.md 'Publishability decision': set status='insufficient' if `story.row.quiz_candidate === false` AND `story.row.editorial_posture === 'disclosure_official'`. Add gate-6: set status='insufficient' if `story.row.quality_flags` contains both 'MIXED_STORY' and 'NUMERIC_TRIVIA_RISK'. Add gate-7: set status='insufficient' if `story.row.consistency_score < 0.30`.
- [2026-05-06 story 215] Stage 2 gate-2 ('all source_documents[].issuer collapse to a single domain root') passed strict letter but failed in spirit: 4/4 sources are 9to5 Network sister sites (9to5google.com ×3 + 9to5mac.com ×1) and 3/4 articles are by the same author (Justin Kahn). Effective source independence is single-perspective; reported source_diversity_score=0.64 ('diverse') overstated it. — check: Add stage-2 gate-2a in video-learning/prompts/02-evidence-package.md: set status='insufficient' if ≥75% of source_documents share a single `author` value. Add gate-2b: extend gate-2 from 'single domain root' to 'single editorial network' by maintaining a small list of known sister-site groupings (9to5google/9to5mac/9to5toys/electrek; vox.com/theverge.com; vice.com/motherboard.vice.com; conde-nast titles) in `tools/lib/source_networks.py`.
- [2026-05-06 story 224] Stage-2 publishability gate-7 (consistency floor) fired on story 224: synth-reported consistency_score of 0.25 is below the 0.30 minimum, so the video pipeline rejected before stage 3. Reinforcing signals: quality_flags=['LOW_SUPPORT'], verification_status='draft', and the operation is referred to by two different code names across the two sources ('Project Freedom' on Trump's Truth Social post; 'Epic Fury' in Rubio's White House remarks). — check: Gate-7 in video-learning/prompts/02-evidence-package.md ('Publishability decision' §7: insufficient if story.row.consistency_score < 0.30) — already in place since story 215; this is the second observed firing and the check works as intended. Operator may use this incident as the second data point when evaluating gate-7's hit rate against synth output volume.

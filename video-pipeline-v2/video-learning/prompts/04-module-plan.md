# Stage 4 — Module plan

You translate the script into a renderer-ready module plan. The renderer
consumes this file directly; sloppiness here shows up as overflow,
mistimed cuts, and missing-asset placeholders.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §3 (text
   hierarchy, per-kind caps), §4 (visual safety, asset hint policy).
2. `video-learning/templates/module-skeletons/hook.md`, `stakes.md`,
   `evidence.md`, `close.md` — read all four before drafting.
   Also read `video-learning/templates/<story_type>.json` for the
   type's preferred module sequence and asset hint policy.
3. `stories/<id>/03_script.md` — the source of truth for `text`.
4. `stories/<id>/02_evidence.json` — the source of truth for
   `evidence_ref` and `numeric_fact_ref`.
5. The nearest approved example: `video-learning/approved-examples/<story_type>/`
   — its `04_module-plan.json` is the structural anchor.

## Inputs
- `stories/<id>/03_script.md`
- `stories/<id>/02_evidence.json`
- `stories/<id>/01_understanding.json`

## Output
- File: `stories/<id>/04_module-plan.json`
- Schema: `video-learning/schemas/module-plan.schema.json`
- Validate: `python tools/validate_artifact.py --story-id <id> --stage module_plan`

## What to produce

```json
{
  "story_id": "<id>",
  "story_type": "<from understanding>",
  "total_duration_sec": <number>,
  "modules": [
    {
      "kind": "hook",
      "text": "<verbatim sentence from script>",
      "duration_sec": <number>,
      "evidence_ref": ["<source_id>", "..."],
      "asset_hint": "<map | data | photo | mute>",
      "numeric_fact_ref": "<id from numeric_facts>" | null
    },
    ...
  ]
}
```

## Module ordering (rigid)

```
1. hook                    (always first)
2. stakes                  (always second)
3. evidence × 1..4         (3 is the sweet spot)
   - quote and map modules may interleave between evidence beats
   - quote requires a verbatim entry in 02_evidence.quotes[]
   - map requires geographic specificity in 01_understanding.where
4. close                   (always last)
```

Module count: 4–7. The schema enforces. 5 is typical; 4 only for very
tight stories; 7 only when both a quote and a map are justified.

## Duration rules

- Compute target total from script: `(word_count / 165) * 60`.
- `total_duration_sec` must be within ±2 seconds of the target.
- Per-kind ranges:

| `kind`     | `duration_sec` range |
| ---------- | -------------------- |
| `hook`     | 2.5 – 4.0            |
| `stakes`   | 4.0 – 8.0            |
| `evidence` | 6.0 – 14.0           |
| `quote`    | 5.0 – 10.0           |
| `map`      | 4.0 – 8.0            |
| `close`    | 5.0 – 10.0           |

If your evidence beats keep going over 14s, the upstream issue is in
stage 3 — the script beat is too long. Tighten the script.

## `text` rule (verbatim, not paraphrase)

The module's `text` field is the on-screen overlay copy — and it must
also match a sentence in the script. Specifically:

- For `hook`, `stakes`, `evidence`, `close`, `quote`: the `text` field
  must equal a sentence (or sentence fragment) that appears verbatim in
  `03_script.md`. Stage 5 will substring-match.
- For `map`: `text` is a place-name + qualifier pulled from
  `01_understanding.where` and the corresponding script beat.

This is also subject to the per-kind caps in playbook §3:

| `kind`     | text max words | text max chars |
| ---------- | -------------- | -------------- |
| `hook`     | 7              | 80             |
| `stakes`   | 7              | 110            |
| `evidence` | 10             | 140            |
| `quote`    | 14             | 130            |
| `map`      | 5 (place)      | 90             |
| `close`    | 9              | 120            |

If the script sentence is longer than the cap, choose the load-bearing
fragment. The TTS speaks the full script; the overlay only shows what
fits.

## `evidence_ref[]` rule

- Every module of `kind: "evidence" | "quote" | "stakes"` must have at
  least one entry in `evidence_ref[]`.
- `hook` and `close` modules should still cite when they reference a
  fact, but `[]` is allowed for a close that points only to an upcoming
  date.
- `map` modules cite the source of the geographic claim, if any.

## `numeric_fact_ref` rule

- Required when the module's `text` asserts a number.
- The id must exist in `02_evidence.numeric_facts[].id`.
- `null` only when no number is asserted.

## `asset_hint` rule (read playbook §4 first)

Walk this decision in order:

1. **Conflict story with casualty count?** → `data` (chart) or `mute`,
   never `photo`.
2. **Module asserts a number?** → `data`. Set `numeric_fact_ref`.
3. **Module is geographic AND `01_understanding.where` has a place
   name?** → `map`. Use `kind: "map"` if the module's main job is
   geographic.
4. **Module is a verbatim quote?** → `mute` (the quote text is the
   asset).
5. **`02_evidence` references an image source for this fact?** → `photo`.
   This is rare; default skeptical.
6. **Default**: `mute`.

If you find yourself wanting `photo` and the source isn't there, choose
`mute`. Stage 5 fails any `photo` hint without an image source.

## Approved-example diff (during this stage)

Before you finish, open the nearest approved example's
`04_module-plan.json`. Compare:

- Module count and kind ordering — does the example use 3 evidence
  beats where you used 5?
- Asset distribution — is the example mostly `data` while you went
  `photo`-heavy?
- Duration distribution — is the example's hook 3.0s where you set 4.0s?

You don't have to match the example, but the differences should be
*intentional*. Note any deliberate departure for stage 5 to evaluate.

## Constraints

- Total `duration_sec` sum equals `total_duration_sec`. (Trivial; check.)
- Every `evidence` module's `numeric_fact_ref` (when set) resolves in
  `02_evidence.numeric_facts[].id`.
- Every `evidence_ref` entry resolves in
  `02_evidence.key_facts[].source_ids[]` ∪
  `02_evidence.numeric_facts[].source_ids[]`.
- `text` length within per-kind caps (playbook §3).

## Failure modes this stage protects against

- `module/order` — caught by the rigid ordering rule.
- `module/duration-drift` — caught by the ±2s rule.
- `module/asset-mismatch` — caught by the asset-hint walk.
- `module/text-paraphrase` — caught by the verbatim rule.
- `render/overflow` — caught by per-kind caps.

## Definition of done

- Schema validates.
- Total duration matches script length within ±2s.
- Every module's `text` appears verbatim in `03_script.md`.
- Every `evidence` / `quote` / `stakes` module cites at least one source.
- No `photo` hint without an image-bearing source.
- Module ordering is `hook → stakes → … → close`.

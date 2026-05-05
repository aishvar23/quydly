# Module: evidence

The substance of the video. 1–4 of these per story.

## Renderer contract
- `kind: "evidence"` | `quote` | `map`
- `duration_sec`: 6.0–14.0
- `text`: 1–3 sentences, ≤ 60 words
- `asset_hint`:
  - `map` — when the module is geographic
  - `data` — when the module is a number, chart, or table
  - `mute` — when the renderer should leave the frame to the text
  - `photo` — only when `02_evidence.json` references an image source
- `evidence_ref`: at least one source_id
- `numeric_fact_ref`: required if the module asserts a number

## Beat structure
1. **Open with a proper noun or a number** — never a connective.
2. **One claim per module** — split if you find yourself using "and".
3. **Attribute when single-sourced** — "according to <body>".

## Quote variant
When `kind: "quote"`:
- `text` is verbatim from `02_evidence.quotes[]`.
- Do not paraphrase. If no quote text exists, use `kind: "evidence"`
  instead.
- Speaker and role appear in the renderer's overlay; do not duplicate in
  `text`.

## Map variant
When `kind: "map"`:
- `asset_hint: "map"`
- `text` calls out the *places named in the frame*, not the content of the
  map.
- Renderer needs at least one place from `01_understanding.where`.

## Common pitfalls
- Stacking multiple claims in one module to "save time".
- Using `data` as the asset hint for a non-numeric claim.
- Forgetting to set `numeric_fact_ref` when the module asserts a number.

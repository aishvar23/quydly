# Stage 2 — Evidence package

You build the cite-able universe the script is allowed to draw from. You
also make the publishability call that gates every later stage.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §1.2 (sourcing)
   and §1.3 (publishability gates).
2. `stories/<id>/story.json` — re-read with sourcing in mind.
3. `stories/<id>/01_understanding.json` — your own work from
   stage 1.
4. `video-learning/learning/known-failure-modes.md` — note any class
   `sourcing/*` entries; tighten checks accordingly.

## Inputs
- `stories/<id>/story.json`
- `stories/<id>/01_understanding.json`

## Output
- File: `stories/<id>/02_evidence.json`
- Schema: `video-learning/schemas/evidence-package.schema.json`
- Validate: `python tools/validate_artifact.py --story-id <id> --stage evidence`

## What to produce

```json
{
  "story_id": "<id>",
  "status": "ok" | "insufficient",
  "reason": "<required if status=insufficient>",
  "key_facts": [
    {
      "text": "<short declarative fact>",
      "source_ids": ["<id from story.row.source_documents[]>", "..."],
      "entity_ids": ["<optional ids from primary_entities_enriched>"]
    }
  ],
  "numeric_facts": [
    {
      "id": "<short stable id, e.g. 'casualty_total' or 'fed_rate'>",
      "value": <number or string>,
      "unit": "<%, $, basis_points, killed, wounded, etc.>",
      "as_of": "<ISO date>",
      "source_ids": ["<id>", "..."],
      "context": "<optional: comparator window, qualifier>"
    }
  ],
  "quotes": [
    {
      "text": "<verbatim quote>",
      "speaker": "<name>",
      "role": "<title/affiliation>",
      "source_id": "<id>"
    }
  ],
  "factual_conflicts": [
    {
      "topic": "<short label>",
      "positions": [
        { "claim": "<position 1>", "source_ids": ["<id>"] },
        { "claim": "<position 2>", "source_ids": ["<id>"] }
      ]
    }
  ],
  "source_diversity": { "score": <number>, "label": "single|narrow|diverse" } | null
}
```

## Field rules

### `key_facts[]`
- Each `text` is a single short declarative — no compound sentences with
  "and".
- Each fact cites at least one `source_id`, drawn from
  `story.row.source_documents[].id`.
- Pull from `key_points` first, but verify each one against the source
  documents — synth-side paraphrase can drift.
- Aim for 5–10 facts. More than 10 means you have not consolidated; less
  than 5 may indicate a thin story (see status rules).

### `numeric_facts[]`
- Pull from `story.row.structured_numbers` first. Every number the script
  may say must already be here.
- `value` precision: keep the exact value the source gives. Do not round.
  If the script needs a rounded version, add a separate entry with a
  `context: "rounded for narration"` note.
- `unit` is mandatory and explicit ("%", "$", "basis_points",
  "killed_24h").
- `as_of` is mandatory. Convert relative dates against `published_at`.
- `source_ids` lists every source that carries the number. If only one
  source has it, that triggers the single-source rule downstream.

### `quotes[]`
- **Verbatim only.** If `story.row` carries no quote text for a claim,
  do not write a quote — leave `quotes: []`.
- `speaker` and `role` are mandatory.
- A paraphrase rendered as a quote is a `sourcing/paraphrase` failure
  (playbook §2). Stage 5 will catch it; do not produce it here.

### `factual_conflicts[]`
- Mirror `story.row.factual_conflicts` verbatim into the schema shape.
  Do **not** collapse conflicts. Do **not** pick a side.
- If a conflict bears on a `numeric_fact`, the numeric fact's
  `source_ids` should reflect only the sources that support its specific
  value — not all sources mentioning the topic.

### `source_diversity`
- Mirror `row.source_diversity_score` and `row.source_diversity_label`
  if present. Otherwise `null`.

## Publishability decision (the gate)

Set `status: "insufficient"` and write `reason` if **any** of:

1. `story.row.source_documents.length < 2` and `key_points.length < 3`.
   (Genuinely thin coverage.)
2. All `source_documents[].issuer` collapse to a single domain root
   (e.g. `nytimes.com`, `nyt.com`, `nytimes.co.uk`). Single outlet =
   single perspective.
3. `verification_status === 'draft'` AND
   `source_diversity_score < 0.40`. (Synth-side audit flagged it.)
4. Story makes a casualty claim and only one source carries the number,
   AND no official body (UN, ICRC, government ministry) is among the
   sources.

When `status: "insufficient"`:
- Fill `key_facts`, `factual_conflicts`, `status`, `reason`.
- Skip `numeric_facts`, `quotes`, `source_diversity` (set to null/empty).
- After writing, the runner stops the flow. Do not produce stages 3–7.
- Do still produce stage 8 (a `failure`-class learning entry explaining
  the rejection).

When `status: "ok"`:
- Fill all fields per the rules above.
- Continue to stage 3.

## Constraints

- Numbers from `story.row` may be cited; numbers from elsewhere may not.
  If the synth missed a number you wish you had, surface it in
  `01_understanding.unknown_or_disputed` and live without it.
- The `summary` field on `story.row` is **not** a source. It is the
  synth's paraphrase. Sources are the domains in `source_documents[]`.
- Conflicts surface; they never get reconciled. The script will quote
  both sides with attribution.

## Failure modes this stage protects against

- `sourcing/unsourced`: every script claim must trace back to here.
  If you didn't put a fact here, the script can't say it.
- `sourcing/single`: by tagging `source_ids` precisely, stage 5 can
  detect single-source claims and demand attribution.
- `sourcing/paraphrase`: by allowing only verbatim in `quotes[]`, stage 4
  cannot create a fake quote module.

## Definition of done

- Schema validates.
- `status` set; `reason` set if insufficient.
- Every `key_fact` has ≥1 `source_id`.
- Every `numeric_fact` has unit + as_of + ≥1 source_id.
- `factual_conflicts` mirrors the source row's conflicts (no collapse).

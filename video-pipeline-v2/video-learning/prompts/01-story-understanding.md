# Stage 1 — Story understanding

You produce a structured read of the source row. Every later stage
inherits this read, so accuracy here compounds.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §5 (story-type
   rules) and §1 (global quality).
2. `stories/<id>/story.json` — read the **whole** row, not just
   the headline.
3. `video-learning/templates/<candidate_type>.json` — read the template
   for the type you think fits before deciding. Also check
   `stories/<id>/template.json` for the frozen snapshot.

## Inputs
- `stories/<id>/story.json`

## Output
- File: `stories/<id>/01_understanding.json`
- Schema: `video-learning/schemas/story-understanding.schema.json`
- Validate: `python tools/validate_artifact.py --story-id <id> --stage understanding`

## What to produce

A JSON object with these fields. Field-by-field rules below.

```json
{
  "story_id": "<id>",
  "story_type": "<one of: geopolitics, finance, conflict, policy, tech>",
  "core_claim": "<one declarative present-tense sentence>",
  "who": ["<proper-noun actor>", "..."],
  "what": "<verb phrase, not a sentence>",
  "when": "<absolute date or date range>",
  "where": ["<place name>", "..."],
  "frame": "<one of: breaking, tally_official, analysis, policy_move, market_move>",
  "editorial_posture": "<mirror of row.editorial_posture or null>",
  "unknown_or_disputed": ["<thing the source does not settle>", "..."]
}
```

### `story_type`
Pick by walking these checks in order. Stop at the first match.

0. **Service-journalism early-reject.** If `editorial_posture ===
   'disclosure_official'` AND `quality_flags` contains
   `NUMERIC_TRIVIA_RISK` AND `quiz_candidate === false` → write
   `_blockers.md` with "service-journalism rejection: retail-deal /
   affiliate-aggregation pattern" and stop. Do **not** produce
   `01_understanding.json`. The runner stops the flow; stage 8 still
   runs with `outcome: "rejected"`. (See playbook §1.3 gate-5.) The
   `tools/lib/story_type.py` seed mirrors this — when the seed returns
   `"service-journalism"`, `tools/process_story.py` exits with code 5
   before workspace creation.
1. `editorial_posture === 'tally_official'` and casualties / military
   action mentioned → **conflict**.
2. `editorial_posture === 'policy_move'` or primary actor is a regulator
   / legislature / court → **policy**.
3. `category_id === 'tech'` and the news is the product / model / outage
   → **tech**.
4. `primary_entities` has a public company or central bank and the hook
   is a number with a unit → **finance**.
5. `category_id === 'world'` and named state actors are present →
   **geopolitics**.
6. None of the above → write `_blockers.md` saying "no registered story
   type matches; surface as `template_proposal`". Do not invent a type.

### `core_claim`
- One sentence. Present tense. No hedge words.
- Built from `who + what + where + when` with the most-load-bearing facts
  from `key_points` and `summary`.
- Bad: "It seems Tokyo may have grounded flights."
- Good: "Tokyo grounds all flights to Sapporo after a 6.4 earthquake."

### `who`
- Proper-cased actors. Pull names from `primary_entities_enriched`
  verbatim. If only `primary_entities` is present, proper-case
  conservatively.
- "Officials" / "sources" / "the government" are **not** valid entries —
  name the agency or person.
- 1–6 entries. More than 6 means the story is too broad; trim to the
  load-bearing actors.

### `what`
- A phrase, not a sentence. The action.
- Bad: "Tokyo grounded all flights."
- Good: "ground all Sapporo-bound flights".

### `when`
- Absolute. Convert "yesterday" / "Tuesday" against `published_at` →
  ISO date. Convert "this week" → date range.
- If the source row gives a date range, mirror it.

### `where`
- Pull from `primary_places[].name` first.
- If `primary_places` is empty, translate `primary_geos` (ISO codes) via
  the gazetteer that already exists in `src/integrations/supabase.js`.
- If both are empty, the story has no geographic anchor — set `where: []`
  and surface in `unknown_or_disputed`.

### `frame`
- `breaking` — recent event, still developing
- `tally_official` — a count from an official source (casualties,
  votes, prices)
- `analysis` — explanatory piece, not breaking
- `policy_move` — a rule / regulation / ruling
- `market_move` — a price / index / earnings number
- Mirror `editorial_posture` when it maps clearly. When it does not,
  pick the closest and note in `unknown_or_disputed`.

### `unknown_or_disputed`
- Items the source row explicitly does not settle.
- Pull from `factual_conflicts` first (one entry per conflict topic).
- Add anything you noticed that the script might trip on:
  unclear timeline, missing actor identity, ambiguous causation.
- Empty array is fine — but if `verification_status === 'draft'`, the
  array should not be empty. The synth flagged it for a reason.

## Constraints (stage-level rules, in addition to schema)

- Do not introduce facts that are not in `story.json`. If you reach
  for outside knowledge, you have crossed the line. Note it in
  `unknown_or_disputed` and stop.
- Do not paraphrase names. Use exact spelling from
  `primary_entities_enriched`.
- Do not collapse a date range to a single date.

## Failure modes this stage protects against

- `story_type` mismatch (downstream uses wrong template) — caught by the
  walk-the-checks rule.
- "Officials say" treated as actor — caught by the `who` rules.
- Missing geographic anchor passed silently to stage 4 (map asset fails)
  — caught by `where: []` + `unknown_or_disputed` requirement.

## Definition of done

- Schema validates.
- `story_type` matches an existing template.
- `who`, `what`, `where`, `when`, `core_claim` all populated.
- `unknown_or_disputed` is honest — empty only if the story really is
  clean.

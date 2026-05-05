# Stage 3 — Voiceover script

You write the spoken-word script. Every word will be heard. Every fact
must already be in `02_evidence.json`.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §1.4 (voice),
   §3 (text hierarchy), §6 (anti-patterns).
2. `video-learning/templates/<story_type>.json` — type-specific hook
   patterns, banned constructions, and stage-3 extra checks. Use
   `stories/<id>/template.json` if you want the snapshot frozen at fetch.
3. `video-learning/templates/module-skeletons/hook.md` and `close.md`.
4. `stories/<id>/01_understanding.json` — the structured read.
5. `stories/<id>/02_evidence.json` — the only facts you may cite.
6. The nearest approved example:
   `video-learning/approved-examples/<story_type>/` if one exists. Read
   its `03_script.md` end-to-end before drafting.
7. `video-learning/learning/known-good-patterns.md` — replicable wins
   for hooks and stakes.

## Inputs
- `stories/<id>/01_understanding.json`
- `stories/<id>/02_evidence.json`

## Output
- File: `stories/<id>/03_script.md`
- Format: markdown (no schema; length and structure are checked at stage 5)

## Script structure

```markdown
# Script — story <id>

## Hook (3s, 8–11 words)
<one sentence; concrete subject in first 4 words; no question, no hedge>

## Stakes (5–8s, 18–24 words)
<1–2 sentences; named population (with a number) or concrete deadline>

## Evidence (35–55s, 100–160 words)
### Beat 1
<short paragraph; opens with proper noun or number>

### Beat 2
<short paragraph; opens with proper noun or number>

### Beat 3
<short paragraph; opens with proper noun or number>

(Beat 4 only if a quote or map module is justified)

## Close (5–10s, 14–24 words)
<forward-looking; date or scheduled event; not a summary>
```

## Hard length targets

| Section  | Words   | Seconds @ 165 WPM |
| -------- | ------- | ----------------- |
| Hook     | 8–11    | 3                 |
| Stakes   | 18–24   | 6–8               |
| Evidence | 100–160 | 35–55             |
| Close    | 14–24   | 5–9               |
| **Total**| **140–219** | **~50–75**     |

The total target including pauses sits at 60–90s. If your draft is over
250 words, it will not fit; cut before stage 4.

## Source-tagging rule (mandatory)

After every sentence that asserts a number, name, or quote, append an
HTML comment with the source id from `02_evidence.json`:

```
The Fed held rates at 4.50%. <!-- src: doc-1234 -->
```

Multiple sources are listed in order of authority:

```
At least 47 people were killed. <!-- src: doc-9001, doc-9002 -->
```

Stage 5 will validate every digit / proper noun / quote-mark passage
has a trailing src comment. Missing comment = blocker.

## Hook rules

Read playbook §6 before writing. The hook is the highest-leverage
sentence in the video; this is where most regressions start.

- **First 4 words must contain a proper noun or a unit-bearing number.**
- **No question marks. No "what if" / "could" / "may" / "seems".**
- **No generic openers**: "In a major development", "Breaking",
  "Big news from", "It's been a wild day for".
- **One claim only.** No "and" or "while" stitching.
- **Match a hook pattern** from the type template (geopolitics: move +
  actor + place; finance: body + decision + magnitude; conflict: tally +
  place + window; policy: body + verb + scope; tech: vendor + ship/incident
  + delta).

If you cannot meet these constraints from the evidence, the problem is
upstream: stage 2 didn't surface a strong-enough fact. Surface this in
`_blockers.md` rather than weakening the hook.

## Stakes rules

- **Name the affected population with a number** ("18 million expats",
  "1.4 million households on Frontier", "30 million on adjustable-rate
  mortgages"). The Stakes section must contain at least one digit-bearing
  token.
- **Or name a concrete deadline** ("ahead of the Friday vote", "with
  the rainy season starting in three weeks").
- **Banned**: "the world", "everyone", "many people", "tensions rise",
  "investors will be watching".
- **Banned moralisers**: "tragic", "shocking", "brutal", "heroic",
  "devastating".

## Evidence-beat rules

- Each beat is 1 short paragraph (2–3 sentences).
- Each beat opens with a proper noun or a number — never a connective
  ("Meanwhile", "However", "Also").
- One claim per beat. If you reach for "and", split into another beat
  or drop the second clause.
- If a number is single-sourced (one entry in
  `numeric_facts[].source_ids`), the beat must say "according to <body>"
  before the number. This is mandatory for casualty figures.
- If a `factual_conflict` bears on a beat, surface both sides:
  "The DOJ filing shows $10B; the New York Times reports $8B."

## Close rules

- **Forward-looking only.** A date, a scheduled event, a deadline. Pulled
  from a `numeric_fact.context` or surfaced in `01_understanding.when`
  if not in evidence.
- **Banned**: "Time will tell", "Stay tuned", "Only time will tell",
  "We'll see", any restatement of the hook.
- If no forward-looking anchor exists in the evidence, the close states
  what is unresolved: "The deal still needs Senate approval before <date>."

## Constraints (in addition to schema-less file)

- Every digit, percentage, currency figure, and quoted line in the script
  must have a trailing `<!-- src: ... -->` comment.
- No words that did not survive playbook §1.4 (banned hedges, banned
  moralisers).
- Proper-cased names exactly as in `01_understanding.who`. No spelling
  drift.
- Numbers exactly as in `numeric_facts`. If you want a rounded
  expression, the rounded value must already exist in `numeric_facts`
  with `context: "rounded for narration"`.

## Failure modes this stage protects against

- `hook/question`, `hook/hedge`, `hook/generic-opener` — caught by the
  hook rules above; do not write something stage 5 must reject.
- `stakes/abstract`, `stakes/moralising` — caught by the stakes rules.
- `sourcing/unsourced` — caught by the source-tagging rule. Stage 5
  enforces.

## Definition of done

- Total word count between 140 and 250.
- Hook section: one sentence, no `?`, first 4 words contain proper noun
  or number.
- Stakes section: ≥1 digit-bearing token.
- Every numeric / quoted / proper-noun-bearing sentence has a trailing
  `<!-- src: ... -->` comment.
- No banned phrases (run a mental grep before saving).
- Stage 4 can read this without further context.

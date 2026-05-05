# Stage 8 — Learning extractor

You distil this story's experience into entries that future stories can
use. The output is the only thing that survives the workspace into the
system's memory. Make every entry load-bearing or do not write it.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §2 (failure
   taxonomy) and §8 (how learning records update the system).
2. Every artifact in `stories/<id>/`:
   - `story.json` through `07_post-render-critique.json` (whichever
     stages produced output).
   - `_blockers.md` if it exists.
3. `video-learning/learning/known-failure-modes.md` — to avoid
   duplicating an existing entry; instead, link to it.
4. `video-learning/learning/known-good-patterns.md` — same: link, do
   not duplicate.

## Inputs
- Every artifact in the workspace.

## Output
- File: `stories/<id>/08_learning.json`
- Schema: `video-learning/schemas/learning-record.schema.json`
- Validate: `python tools/validate_artifact.py --story-id <id> --stage learning`

## What to produce

```json
{
  "story_id": "<id>",
  "story_type": "<from understanding; or '?' if rejected at stage 1>",
  "outcome": "published" | "iterated" | "scrapped" | "rejected",
  "subjective_quality": 1-5 | null,
  "entries": [
    {
      "category": "failure | pattern | rule_proposal | template_proposal | prompt_proposal | example_promotion",
      "summary": "<one sentence>",
      "evidence": "<artifact path + field/line>",
      "future_check": "<what would catch this next time>",
      "links": ["<existing entry in known-failure-modes.md or known-good-patterns.md>"]
    }
  ]
}
```

## Outcome decision

Pick the outcome from these signals:

| Outcome      | Trigger                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `published`  | Stage 7 `decision: "publish"` and `subjective_quality >= 4`.                              |
| `iterated`   | Stage 7 `decision: "iterate"` (revisions required, not yet done).                         |
| `scrapped`   | Stage 7 `decision: "scrap"` OR stage 5 hit the 3-iteration cap with blockers remaining.   |
| `rejected`   | Stage 2 `status: "insufficient"` (story never reached render).                            |

Always set `subjective_quality` to the stage-7 score, or `null` if the
story did not reach stage 7.

## Entry rules — what makes a good entry

Every entry has *all four* of:

- **Category** that matches what should happen next:
  - `failure` — name a `render/*`, `sourcing/*`, `hook/*`, `stakes/*`,
    `module/*`, or `learning/*` class from playbook §2.
  - `pattern` — a replicable win.
  - `rule_proposal` — a new global rule for the playbook.
  - `template_proposal` — an edit to a story-type or module-skeleton
    template.
  - `prompt_proposal` — an edit to one of the seven stage prompts.
  - `example_promotion` — this story should join
    `approved-examples/<type>/`.
- **Summary** — one sentence stating what happened.
- **Evidence** — a file path and field or line. "Felt off" is not
  evidence. "Stage-5 critique flagged C8 (weak hook anchor) but the
  blocker check missed that the proper noun was inside a parenthetical"
  is evidence.
- **Future check** — a *test* that would catch this next time. Name a
  file, a regex, a threshold, or a stage. Bad: "Be more careful". Good:
  "Add `\\bwhat if\\b` to the banned-hedge regex in
  `prompts/03-voiceover-script.md` § Hook rules."

## What to write — by outcome

### Outcome: `published`
- 1–3 `pattern` entries naming what worked. Be specific: "First-4-words
  hook used a digit + currency token (`$8.4B`); landed on the L1 in
  0.2s per manifest. Replicate for finance type."
- 0–1 `example_promotion` entry if the story beats current best on a
  named axis. Cite the axis. (See playbook §7 for the qualifier rules.)
- 0–2 `failure` entries for issues that survived to render but did not
  block publish (warns from stage 5/7).

### Outcome: `iterated`
- 1–3 `failure` entries naming the blocker classes that triggered
  iteration.
- 0–2 `prompt_proposal` entries if a stage prompt failed to surface a
  problem the critic later caught. Name the prompt and the gap.

### Outcome: `scrapped`
- ≥1 `failure` entry naming the root class.
- 1 `prompt_proposal` *or* `rule_proposal` if the failure indicates the
  system did not protect against this class. (If the failure is in §2
  but had no check, the proposal is to add the check.)
- Capture *why* iteration could not save it — that is the most
  valuable lesson.

### Outcome: `rejected` (stage 2)
- 1 `failure` entry naming the publishability gate that fired.
- Surface upstream signal: which `story.row` field was the proximate
  cause? Was it `verification_status === 'draft'`? `source_diversity_score`?
  This goes into the entry's `evidence`.
- Often an entry in this case is a `template_proposal` for the synth's
  upstream extractors — note as such if it would matter.

## Two-strike rule (for `rule_proposal`)

A `rule_proposal` should only be written when this story is the *second*
occurrence of a class. Check `known-failure-modes.md` for prior entries
of the same class; cite them in `links[]`. If this is the first
occurrence, write a `prompt_proposal` instead — the prompt is the
right place to act on a single incident.

## Anti-patterns for this stage

- ❌ "The hook felt weak." — no future check, no evidence path.
- ❌ "Be careful with numbers." — generic; not testable.
- ❌ One entry per stage that just summarises the stage's output.
- ❌ `pattern` entries that are not testable replications.
- ❌ Skipping `example_promotion` for a strong run "because it doesn't
  feel quite right". The system needs anchors; promote.
- ✅ "Stage 4 set `asset_hint: 'map'` for the stakes module against the
  type-template recommendation; manifest showed unlabelled map fallback.
  Add a check at stage 4 that map modules have `01_understanding.where`
  with ≥1 specific place name (city or named region)."

## Constraints

- `entries` may be empty only if `outcome === "published"` AND there is
  literally nothing to record (vanishingly rare; usually still 1
  `pattern`).
- Do not write more than 6 entries per story. If you have more, the most
  important 6 are the contribution; the rest are noise.
- Cross-link existing entries via `links[]` rather than duplicating them.
- Do not edit any other file in this stage. Just write the JSON.

## After writing

The runner reminds the operator:

```
python tools/update_learning.py --story-id <id>
```

This rolls entries into `LEARNING_RECORD.md` and routes failures /
patterns into the indexes. Proposals are flagged for the operator's
between-stories review (playbook §8).

## Failure modes this stage protects against

- `learning/vague` — caught by the future_check and evidence requirements.
- `learning/no-rollup` — caught by the runner reminding the operator.
- Promotion drift — by surfacing `example_promotion` deliberately, the
  approved-example index actually grows.

## Definition of done

- Schema validates.
- `outcome` and `subjective_quality` reflect stage 7 (or stage 2 if
  rejected).
- 1–6 entries, each with category, summary, evidence (with artifact
  path), and a testable `future_check`.
- Two-strike rule applied to any `rule_proposal`.
- The runner has been told to invoke `update_learning.py`.

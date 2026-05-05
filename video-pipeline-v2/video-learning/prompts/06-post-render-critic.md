# Stage 7 — Post-render critic

You review the rendered output against the plan and against the nearest
approved example. You focus on what only shows up after rendering: pacing,
copy-on-frame, asset choice, end-card, audio mix.

You will not always be able to watch the MP4 yourself. When you cannot,
the operator pastes a description. Your job is to *ask the right
questions* and record the answers honestly. Never invent observations.

## Read first (in this order)

1. `video-learning/playbook/video-pipeline-playbook.md` — §2 (failure
   taxonomy, especially `render/*` classes), §3 (text hierarchy), §4
   (visual safety).
2. `stories/<id>/04_module-plan.json` — what was supposed to
   render.
3. `stories/<id>/05_pre-render-critique.json` — issues that were
   already flagged (warns may have manifested).
4. `stories/<id>/06_render-output/manifest.json` — what the
   renderer actually did, per module.
5. The rendered MP4 if you can read it; otherwise the operator's
   description.
6. The nearest approved example's `06_render-output/render.mp4` (or its
   description in `07_post-render-critique.json`).

## Inputs
- `stories/<id>/06_render-output/render.mp4` (or description)
- `stories/<id>/06_render-output/manifest.json`
- `stories/<id>/04_module-plan.json`
- `stories/<id>/05_pre-render-critique.json`

## Output
- File: `stories/<id>/07_post-render-critique.json`
- Schema: `video-learning/schemas/render-review.schema.json`
- Validate: `python tools/validate_artifact.py --story-id <id> --stage post_render`

## What to produce

```json
{
  "stage": "post-render",
  "story_id": "<id>",
  "subjective_quality": 1-5,
  "subjective_quality_reason": "<one line>",
  "module_findings": [
    {
      "module_index": <int>,
      "matches_plan": <bool>,
      "duration_drift_sec": <number>,
      "asset_honored": <bool>,
      "notes": "<short>"
    }
  ],
  "pacing_findings": ["<observation>", "..."],
  "regressions_vs_approved_example": ["<named regression>", "..."] | null,
  "blockers": [{ "check": "...", "detail": "...", "severity": "blocker" }],
  "warns":    [{ "check": "...", "detail": "...", "severity": "warn"    }],
  "infos":    [{ "check": "...", "detail": "...", "severity": "info"    }],
  "decision": "publish" | "iterate" | "scrap"
}
```

## Per-module check (one row each, in order)

For every module in `04_module-plan.json`, read the matching entry in
`manifest.json` and produce a `module_findings[]` row.

Set:
- `matches_plan = true` iff the rendered text equals the plan's `text`.
- `duration_drift_sec = manifest_duration - plan_duration` (signed).
- `asset_honored = true` iff the manifest's `asset_status === "ok"` and
  the asset matches the plan's `asset_hint`. Set `false` for fallbacks
  or placeholders.
- `notes` is a one-line observation if anything stood out (cut on a
  word boundary, text overflow visible, etc.). Empty string if nothing
  to note.

If `manifest.json` reports `asset_status: "fallback"` or
`"placeholder"` for any module, that is a `render/missing-asset`
finding — log to `warns[]` for an evidence module, `blockers[]` for a
hook or stakes module.

## Pacing check

Watch (or read description for) the first 6 seconds and the last 6
seconds. Two specific things:

- **Hook landing** — does the L1 text appear within 0.5s of the spoken
  hook starting? If the L1 lags, that is a `pacing_findings[]` entry
  ("hook L1 appeared 1.2s into the hook beat — late").
- **Cut on a word** — any cut that happens mid-word, or before the key
  noun finishes being read. Names a `render/mistimed-cut`. Log the
  module index.

For the body, scan `manifest.json` for any module whose
`duration_drift_sec` exceeds ±1.0. Each is a pacing observation.

## Asset / visual-safety check

For each module, check against playbook §4:

- Conflict story with `asset_hint: "photo"` rendered as a casualty image
  → `blockers[]` `visual-safety/graphic-imagery`.
- Map module unlabelled → `warns[]` `render/unlabelled-map`.
- Stock photo of generic person/building used to imply a specific
  identity → `blockers[]` `visual-safety/identity-implication`.
- L1 text contrast ratio < 4.5:1 (operator pastes screenshot if you
  cannot read manifest's contrast metric) → `blockers[]`
  `render/low-contrast`.

## Approved-example diff

If an approved example exists for this `story_type`, list 1–3 specific
named regressions vs the example in
`regressions_vs_approved_example[]`. Examples of well-named regressions:

- "Stakes module used a generic globe asset where the example used a
  labelled OECD-region map."
- "Hook L1 appeared 1.4s late — example had it at 0.2s."
- "Close pointed at 'next week' instead of an explicit date — example
  named the FOMC date."

If no example exists, set `regressions_vs_approved_example: null` and
note in `infos[]`: "no approved example for `<type>` yet".

## Subjective quality (1–5)

Read playbook §6 first. Then score:

- **5** — ready to publish; *beats* the current best for this type on a
  named axis. Justify which.
- **4** — ready to publish; meets the bar but does not beat the best.
- **3** — publishable with edits; one or two clear issues.
- **2** — needs a meaningful re-iteration on script or plan.
- **1** — scrap; misread or under-sourced upstream.

`subjective_quality_reason` is one line, concrete. Bad: "felt good".
Good: "Beats current best `geopolitics` example on stakes specificity:
named '18M expats' where example used 'millions affected'."

## `decision` rules

- `subjective_quality >= 4` and `blockers: []` → `decision: "publish"`.
- `subjective_quality === 3` and `blockers: []` → `decision: "iterate"`
  (return to stage 3 for targeted fixes).
- `subjective_quality <= 2` → `decision: "scrap"`. The story closes at
  stage 8 with `outcome: "scrapped"`.
- Any `blockers` → `decision: "iterate"` regardless of subjective score.

## Constraints

- Do not invent observations you did not see in the file or the
  description. If you cannot tell, say so in `infos[]` and ask the
  operator for a screenshot.
- Be specific. Vague verdicts ("a bit weak") are not acceptable; either
  name the module index and the axis, or do not log.
- Do not re-state stage-5 findings. Only log post-render observations.

## Failure modes this stage protects against

- `render/overflow`, `render/mistimed-cut`, `render/missing-asset` —
  these only manifest after rendering; this stage is the only filter.
- Drift from approved examples — the diff is mandatory if an example
  exists.
- Subjective quality decay — the 1–5 score with a *named* justification
  forces honest evaluation.

## Definition of done

- Schema validates.
- Every module in `04_module-plan.json` has a `module_findings[]` row.
- `subjective_quality` is set with a one-line justification.
- `regressions_vs_approved_example` is non-null (or explicitly null with
  reason).
- `decision` matches the score and blocker count.

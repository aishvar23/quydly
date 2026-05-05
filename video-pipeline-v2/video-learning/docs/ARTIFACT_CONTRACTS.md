# Artifact contracts

Every artifact a stage produces has a JSON Schema in
`video-learning/schemas/`. This document is the human-readable summary;
the schemas are the source of truth.

## 01 — `01_understanding.json`

The structured read of the source row.

| Field                  | Type        | Notes                                                          |
| ---------------------- | ----------- | -------------------------------------------------------------- |
| `story_id`             | int/string  | Mirrors the workspace folder name.                             |
| `story_type`           | enum        | One of legal-scandal, geopolitics, finance, conflict, policy, tech. |
| `core_claim`           | string      | One declarative sentence.                                      |
| `who`                  | string[]    | Proper nouns of actors.                                        |
| `what`                 | string      | Action phrase, not a sentence.                                 |
| `when`                 | string      | Date or date range.                                            |
| `where`                | string[]    | Place names from `primary_places`.                             |
| `frame`                | enum        | breaking / tally_official / analysis / policy_move / market_move |
| `unknown_or_disputed`  | string[]    | What the source does not settle.                               |
| `editorial_posture`    | string?     | Mirror of synth field if present.                              |

## 02 — `02_evidence.json`

Everything the script is allowed to assert. Also the publishability gate.

Top-level: `status` is `ok` or `insufficient` (with `reason`).

| Block                  | Required for `status: ok`                                |
| ---------------------- | -------------------------------------------------------- |
| `key_facts[]`          | Yes; each cites ≥1 source_id.                            |
| `numeric_facts[]`      | When the story has any number; each has unit + as_of.    |
| `quotes[]`             | Only when `story.json` carries verbatim quote text.      |
| `factual_conflicts[]`  | When sources disagree.                                   |
| `source_diversity`     | Mirror of synth field, or null.                          |

## 03 — `03_script.md`

Markdown. Sections: Hook (3s) / Stakes (5–8s) / Evidence (35–55s) /
Close (5–10s). 165–250 words total. Every numeric/quoted claim has a
trailing `<!-- src: <source_id> -->` comment.

## 04 — `04_module-plan.json`

Renderer-ready plan. Total duration matches script ±2s.

| Field                         | Notes                                                    |
| ----------------------------- | -------------------------------------------------------- |
| `total_duration_sec`          | 30–120.                                                  |
| `modules[]`                   | 4–7. First is `hook`, last is `close`.                   |
| `modules[].kind`              | hook / stakes / evidence / quote / map / close.          |
| `modules[].text`              | Verbatim from the script.                                |
| `modules[].evidence_ref`      | Source_ids backing the module.                           |
| `modules[].asset_hint`        | map / data / photo / mute. Default to mute if unsure.    |
| `modules[].numeric_fact_ref`  | Required when the module asserts a number.               |

## 05 / 07 — `render-review.json`

Same schema for pre- and post-render. `stage` field disambiguates.

| Field                              | Pre | Post |
| ---------------------------------- | --- | ---- |
| `blockers[]`                       |  *  |  *   |
| `warns[]`                          |  *  |  *   |
| `infos[]`                          |  *  |  *   |
| `decision`                         | render/iterate | publish/iterate/scrap |
| `approved_example_diff`            |  *  |      |
| `subjective_quality`               |     |  *   |
| `subjective_quality_reason`        |     |  *   |
| `module_findings[]`                |     |  *   |
| `pacing_findings[]`                |     |  *   |
| `regressions_vs_approved_example`  |     |  *   |

## 08 — `08_learning.json`

The story's contribution to the system-wide learning index.

Each `entries[]` item has `category`, `summary`, `evidence` (artifact path
+ field), and `future_check` (the test that would catch this next time).
Categories drive routing in `tools/update_learning.py`:

| Category             | Routed to                         |
| -------------------- | --------------------------------- |
| `failure`            | `known-failure-modes.md`          |
| `pattern`            | `known-good-patterns.md`          |
| `rule_proposal`      | flagged in `LEARNING_RECORD.md`   |
| `template_proposal`  | flagged in `LEARNING_RECORD.md`   |
| `prompt_proposal`    | flagged in `LEARNING_RECORD.md`   |
| `example_promotion`  | flagged in `LEARNING_RECORD.md`   |

Proposals are *not* auto-applied. The operator promotes them between
stories.

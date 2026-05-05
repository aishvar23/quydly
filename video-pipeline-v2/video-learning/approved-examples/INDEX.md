# Approved examples — index

Gold-standard outputs by story type. The pre- and post-render critique
stages diff against the nearest approved example for the current type.

Promotion is manual: when an `08_learning.json` includes an
`example_promotion` entry and the operator agrees, copy the workspace's
key artifacts into `<type>/<story_id>/` and add a row below.

| Story type   | Story id | Date promoted | Strengths                  | Pinned to render version |
| ------------ | -------- | ------------- | -------------------------- | ------------------------ |
| _(none yet)_ |          |               |                            |                          |

## What gets copied

When promoting, copy these files only — do not copy `story.json` (it
has source-doc URLs that may rot):

```
video-learning/approved-examples/<type>/<id>/
├── 03_script.md
├── 04_module-plan.json
├── 06_render-output/render.mp4    (optional, if small)
└── 07_post-render-critique.json   (the reason it was promoted)
```

## When to retire an example

- The renderer's module contract changes incompatibly. Bump
  `pinned_to_render` and review the example.
- A newer story for the same type rates 4+ on subjective_quality and beats
  the existing example on a named regression. Replace.
- The example repeatedly anchors critiques toward a stale style. Retire
  rather than rewrite.

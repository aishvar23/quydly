# Quydly Video Pipeline — v2

Sibling to `evidence-first-video-pipeline/`. The migration target.

## What's here

- `src/render/shared/motion.ts` — motion-design tokens (EASE / BEAT / SPRINGS) + hooks (`useBeat`, `useSpringIn`, `useCountUp`, `useDrawIn`, `useRiseIn`, `useStaggered`).
- `src/render/shared/brand.ts` — typography + safe zones + accent palette.
- `src/render/shared/types.ts` — `RenderModule` shape (single source of truth).
- `src/render/modules/NumberCard.tsx` — first redesigned editorial module.
- `src/render/Root.tsx` — currently registers the `NumberSlice` standalone composition.

## Render the slice

```bash
npm install
npm run render:number-slice
```

Output: `output/slice-number/v1/slice.mp4`.

## What's *not* here yet

Everything else. This folder will grow one module per slice. The pipeline orchestration (story → understanding → evidence → script → modules → render) will be ported from `evidence-first-video-pipeline/` once the module library has reached parity.

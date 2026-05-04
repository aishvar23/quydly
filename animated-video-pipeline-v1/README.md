# Quydly Animated Video Pipeline V1

Clean V1 foundation for turning curated Gold Set stories into short animated editorial explainers.

This folder is intentionally separate from `video-pipeline/` and `animated-video-pipeline/`.

## Architecture Summary

The canonical flow is:

```text
story -> audit -> script -> voice timing -> scene plan -> assets -> Remotion render -> FFmpeg export -> metadata -> publish queue
```

The key design choice is that the pipeline builds one canonical story package first, then renders platform outputs from that package. LLMs can help write scripts, but they do not freely choose assets or visual behavior.

## Main Modules

```text
src/
  cli/generate-video.js
  pipeline/
    orchestrator.js
    job-states.js
    selectors/select-video-candidates.js
    audit/video-candidate-audit.js
    script/generate-script.js
    voice/generate-voice.js
    scenes/scene-types.js
    scenes/story-templates.js
    scenes/plan-scenes.js
    assets/resolve-assets.js
    assets/stock-client.js
    assets/map-client.js
    render/render-video.js
    render/export-video.js
    subtitles/generate-srt.js
    metadata/generate-metadata.js
    publish/*.js
  render/
    Root.tsx
    compositions/ShortVideo.tsx
    scenes/HookScene.tsx
    scenes/ContextScene.tsx
    scenes/MapScene.tsx
    scenes/DataScene.tsx
    scenes/OutroScene.tsx
```

## Job States

`QUEUED`, `STORY_VALIDATED`, `VIDEO_CANDIDATE_REJECTED`, `SCRIPT_GENERATING`, `SCRIPT_READY`, `VOICE_GENERATING`, `VOICE_READY`, `SCENE_PLAN_READY`, `ASSETS_RESOLVING`, `ASSETS_READY`, `SUBTITLES_READY`, `RENDERING`, `RENDER_READY`, `EXPORTING`, `READY_TO_PUBLISH`, `REVIEW_REQUIRED`, `PUBLISHING`, `PUBLISHED`, `FAILED`.

## Visual Rules

V1 uses exactly three persistent text layers:

1. Editorial overlay: large, selective, 3-5 words.
2. Subtitles: small, supportive, never dominant.
3. Brand mark: small and persistent.

Visuals should feel like an animated explainer channel: maps, documents, charts, institutions, interface context, and restrained motion graphics. V1 avoids fake event footage, synthetic human reenactments, giant captions, and generic stock montages.

## Scene Components

- `HookScene`: high-contrast opening, strongest editorial overlay.
- `ContextScene`: contextual image/video or branded motion fallback.
- `MapScene`: Mapbox static image when available, animated grid fallback otherwise.
- `DataScene`: chart-like motion card for one key figure or verification cue.
- `OutroScene`: short brand lockup.

## Story-Type Templates

- `legal_scandal`: documents -> court/institution -> data card -> map -> impact -> outro.
- `geopolitics_world`: map -> government context -> data card -> map -> newsroom context -> outro.
- `finance_markets`: market motion -> data card -> market context -> map -> impact -> outro.
- `tech_cyber`: interface context -> newsroom context -> data card -> map -> impact -> outro.

Templates point to controlled `sceneType` values in `src/pipeline/scenes/scene-types.js`. That file owns asset policy and query templates.

## Asset Resolution

Asset resolution is controlled in code:

- Map scenes try Mapbox first.
- Safe contextual or illustrative scenes try Pexels with approved query templates.
- Risky legal or political concepts avoid video by default.
- Every scene has a branded motion fallback.

The story's primary entities are blocked from asset metadata checks so contextual stock does not imply direct footage of named people.

## Automation Plan

1. Select verified, high-confidence story candidates from Supabase.
2. Audit visual suitability and safety.
3. Generate a spoken script and editorial overlay phrases.
4. Generate ElevenLabs narration, or timing-only metadata for dry runs.
5. Convert the script into a controlled scene plan.
6. Resolve safe assets from Mapbox/Pexels or branded fallbacks.
7. Render the Remotion `ShortVideo` composition.
8. Re-encode final vertical MP4 through FFmpeg.
9. Write metadata for review or publishing.
10. Keep platform publishers stubbed until review policy is ready.

## Quick Start

```bash
cd animated-video-pipeline-v1
npm install
npm run lint
node index.js --story-file fixtures/sample-story.json --dry-run
```

To render after installing dependencies:

```bash
node index.js --story-file fixtures/sample-story.json --skip-audit
```

API-backed stages degrade gracefully. Without Pexels or Mapbox, assets fall back to branded motion. Without ElevenLabs, the pipeline creates timing metadata but no narration audio.

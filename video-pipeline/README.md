# Quydly Video Pipeline — POC

Turns one curated story into a short-form vertical news explainer video.

**Story 155 → script → narration → asset-backed scenes → 1080×1920 MP4**

---

## Quick Start

```bash
cd video-pipeline
cp .env.example .env        # fill in your keys
npm install
node index.js --story-id 155 --audience-geo global --mode poc
```

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Script + scene plan generation (Claude) |
| `ELEVENLABS_API_KEY` | No | Narration audio. Stub timing used if absent |
| `ELEVENLABS_VOICE_ID` | No | Defaults to Adam (`pNInz6obpgDQGcFmaJgB`) |
| `PEXELS_API_KEY` | No | Stock video/photo per scene. Falls back to motion graphic if absent |
| `MAPBOX_TOKEN` | No | Map image for geo scenes. Falls back to stock/motion if absent |
| `OPENAI_API_KEY` | No | DALL-E 3 last-resort fallback only. Safe to leave blank |
| `FONT_PATH` | No | Font for overlays. Auto-detects Arial (Windows) or Liberation Sans (Linux) |

The only hard requirement is `ANTHROPIC_API_KEY`. Everything else degrades gracefully.

---

## Output

All files written to `output/story-155/`:

```
story-155-script.json       Script + scene plan with beat-aligned timings
story-155-audio.mp3         Narration (or empty stub if no ElevenLabs key)
story-155-subtitles.srt     Word-timed subtitle cues
story-155-video.mp4         Final 1080×1920 MP4
story-155-thumbnail.png     Frame extracted at 1s
story-155-metadata.json     Titles, tags, asset mix summary — ready for platform adapters
assets/                     Downloaded stock assets per scene
```

---

## Pipeline Stages

| # | Stage | State after | What it does |
|---|---|---|---|
| 1 | Story Intake | `STORY_VALIDATED` | Validates story against quality gates. Blocks unverified stories in production mode. |
| 2 | Script Generation | `SCRIPT_GENERATED` | Claude generates 80–120 word script + 6-scene plan. Each scene gets a `safe_visual_concept` (enum, not freeform) and `narration_segment`. |
| 3 | Audio Generation | `AUDIO_GENERATED` | ElevenLabs TTS with character-level timestamps. Stubs synthetic timing if no API key. |
| 4 | Beat Alignment | `BEATS_ALIGNED` | Maps ElevenLabs character timestamps to scene boundaries. Scene durations are derived from real narration timing, not estimates. |
| 5 | Asset Retrieval | `ASSETS_RETRIEVED` | Resolves one asset per scene via fallback chain (see below). |
| 6 | Subtitle Generation | `SUBTITLES_GENERATED` | Builds SRT from word-level timestamps. Max 2 lines, 42 chars per line. |
| 7 | Timeline Composition | `RENDERED` | FFmpeg renders each scene (scale/crop/zoompan/lower-third), then concatenates with audio + subtitle burn-in + Quydly watermark. |
| 8 | Metadata Generation | `METADATA_READY` | Writes titles, tags, asset mix, duration for future platform adapters. |

---

## Asset Fallback Chain

For each scene, tried in order until one passes the quality gate:

```
1. Pexels Videos  — skipped for risky concepts (military, classified docs)
2. Pexels Photos  — all concepts
3. Mapbox Static  — only for geo_map concept, uses built-in gazetteer
4. DALL-E 3       — only if dalle_allowed=true for that concept, no real people
5. Motion Graphic — branded dark background via FFmpeg lavfi, always available
```

---

## Visual Concept System

Claude never generates search queries. It picks one of 9 controlled concepts:

| Concept | Default asset | DALL-E allowed | Risky (contextual only) |
|---|---|---|---|
| `military_personnel_generic` | Pexels photo | Yes | Yes |
| `government_building` | Pexels photo | No | No |
| `courtroom_or_legal` | Pexels video | Yes | No |
| `financial_markets` | Pexels video | Yes | No |
| `geo_map` | Mapbox map | No | No |
| `newsroom_or_media` | Pexels video | No | No |
| `classified_documents` | Pexels photo | Yes | Yes |
| `prediction_market_or_tech` | Pexels video | Yes | No |
| `brand_outro` | Motion graphic | No | No |

Risky concepts skip video and use photos or maps only — they will never show footage that could imply direct coverage of the event.

---

## POC Scope

- One story (ID 155), hardcoded payload in `01-story-intake.js`
- `mode=poc` allows `is_verified=false` with a warning
- `mode=production` blocks unverified stories
- No public auto-publish — `metadata.json` has `mode: "poc_internal_only"`
- Output is gitignored (`output/` directory)

---

## Expanding Later

| What | Where to change |
|---|---|
| Add a new story | `01-story-intake.js` → swap hardcoded payload for Supabase fetch |
| Add a new visual concept | `lib/visual-concept-map.js` → add entry + update Claude prompt enum |
| Add a new geo location | `lib/map-fetcher.js` → add entry to `GEO_GAZETTEER` |
| Add xfade transitions | `lib/ffmpeg-composer.js` → replace concat demuxer with complex xfade filter graph |
| Add background music | `lib/ffmpeg-composer.js` → `composeFinal()`, mix second audio input at low volume |
| Multi-story batch | `pipeline/orchestrator.js` → wrap `runPipeline` in a loop |

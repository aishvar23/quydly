# Music beds

The pipeline plays a music bed underneath the narration. Drop **license-cleared**
audio files here — the pipeline ships none of its own.

## Convention

```
public/music/
├── legal_scandal/         tense, procedural
├── geopolitics_world/     measured, official
├── finance_markets/       sober, analytic
├── election_result/       civic, momentous
├── natural_disaster/      restrained, no melodrama
├── tech_cyber/            synthetic, low-key tense
├── culture_entertainment/ upbeat, contemporary
├── general/               neutral newsroom bed
└── default/               fallback when no type-specific track
```

For each story type, the picker (`src/integrations/music.js :: pickMusicTrack`)
takes the **first audio file** (alphabetical) in the matching directory. Falls
back to `default/` if the type directory is empty. Returns null (silent) when
both are empty.

Supported formats: `.mp3 .wav .m4a .aac .ogg .flac`.

## Volume

The render mixes the bed at **constant volume 0.12** under the narration, set in
`src/render/compositions/EvidenceVideo.tsx`. Tweak that constant if you want a
heavier or lighter bed.

## Where to source tracks

Royalty-free / CC-cleared sources that allow commercial use:
- [Free Music Archive](https://freemusicarchive.org/) — filter to CC-BY / CC0
- [YouTube Audio Library](https://studio.youtube.com/channel/UC/music) — every
  track is cleared for monetised content
- [Mixkit](https://mixkit.co/free-stock-music/) — free for commercial use
- [Bensound](https://www.bensound.com/) — CC-BY (credit required)

For paid:
- [Epidemic Sound](https://www.epidemicsound.com/)
- [Artlist](https://artlist.io/)

## Naming hint

Pick tracks 30-60 seconds long (or longer — Remotion loops automatically).
Avoid tracks with strong melody/vocals; instrumental beds work best under
spoken narration.

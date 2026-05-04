export type ComponentType =
  | "HookScene"
  | "ContextScene"
  | "MapScene"
  | "DataScene"
  | "OutroScene";

export type AssetKind = "video" | "photo" | "map" | "branded" | "data" | "lottie";

export type RenderAsset = {
  kind: AssetKind;
  src: string | null;
  path?: string | null;
  sourceUrl?: string | null;
  safetyClass: string;
  fallbackReason?: string | null;
};

export type RenderScene = {
  sceneId: number;
  role: string;
  componentType: ComponentType;
  sceneType: string;
  visualType: string;
  purpose: string;
  startSec: number;
  durationSec: number;
  overlayText: string;
  narration: string;
  geoLocation: string | null;
  asset: RenderAsset;
};

export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type VideoProps = {
  storyType: string;
  accentColor: string;
  totalDurationSec: number;
  fps: number;
  audioSrc: string | null;
  brandName: string;
  jobKey: string;
  scenes: RenderScene[];
  subtitles: SubtitleCue[];
};

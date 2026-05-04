export type ComponentType =
  | "HookStrap"
  | "PersonCard"
  | "DossierCard"
  | "MapCallout"
  | "NumberCard"
  | "ChargeCard"
  | "TimelineCard"
  | "PlatformCard"
  | "WhyItMattersCard"
  | "OutroLockup"
  | "HookScene"
  | "ContextScene"
  | "MapScene"
  | "DataScene"
  | "OutroScene";

export type AssetKind = "video" | "photo" | "map" | "branded" | "data" | "lottie" | "graphic" | "exact" | "contextual";

export type RenderAssetItem = {
  kind: AssetKind;
  src: string | null;
  path?: string | null;
  sourceUrl?: string | null;
  sourcePage?: string | null;
  credit?: string | null;
  license?: string | null;
  subject?: string | null;
  safetyClass: string;
  fallbackReason?: string | null;
};

export type RenderAsset = RenderAssetItem & {
  people?: RenderAssetItem[];
};

export type RenderModule = {
  moduleId: number;
  role: string;
  componentType: ComponentType;
  startSec: number;
  durationSec: number;
  overlayText: string;
  narration: string;
  assetClass: string;
  data: Record<string, unknown>;
  asset: RenderAsset;
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

export type EvidenceSource = {
  id: string;
  title: string;
  url: string;
  source: string;
};

export type VideoProps = {
  storyType: string;
  accentColor: string;
  totalDurationSec: number;
  fps: number;
  audioSrc: string | null;
  musicSrc?: string | null;
  musicMix?: {
    style: string;
    mixVolume: number;
    durationSec: number;
  } | null;
  brandName: string;
  jobKey: string;
  modules?: RenderModule[];
  scenes?: RenderScene[];
  subtitles: SubtitleCue[];
  evidenceSources?: EvidenceSource[];
  safetyNotes?: string[];
};

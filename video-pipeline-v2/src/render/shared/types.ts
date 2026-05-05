export type ComponentType =
  | "HookStrap"
  | "DossierCard"
  | "PersonCard"
  | "PlatformCard"
  | "NumberCard"
  | "MapCallout"
  | "ChargeCard"
  | "TimelineCard"
  | "WhyItMattersCard"
  | "OutroLockup"
  | "QuoteCard"
  | "ComparisonCard"
  | "EvidenceShelf"
  | "ImpactCard"
  | "VideoClipCard";

export type AssetKind =
  | "graphic"
  | "exact"
  | "contextual"
  | "map"
  | "entity_photo"
  | "place_photo"
  | "photo"
  | "video"
  | "lottie";

export type RenderAsset = {
  kind: AssetKind;
  src: string | null;
  path?: string | null;
  sourceUrl?: string | null;
  credit?: string | null;
  license?: string | null;
  attribution?: string | null;
  entityName?: string | null;
  safetyClass: string;
  fallbackReason?: string | null;
  fallbackHint?: string | null;
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

export type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type EvidenceSource = {
  id?: string;
  type?: string;
  title?: string;
  issuer?: string;
  url?: string;
  date?: string;
};

export type SubtitleBlackoutRange = {
  startSec: number;
  endSec: number;
};

export type VideoProps = {
  storyType: string;
  accentColor: string;
  totalDurationSec: number;
  fps: number;
  audioSrc: string | null;
  musicSrc?: string | null;
  brandName: string;
  jobKey: string;
  modules: RenderModule[];
  subtitles: SubtitleCue[];
  subtitleBlackouts?: SubtitleBlackoutRange[];
  publishedDate?: string | null;
  evidenceSources?: EvidenceSource[];
  safetyNotes?: string[];
};

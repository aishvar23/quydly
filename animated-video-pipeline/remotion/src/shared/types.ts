export type ComponentType = "HookScene" | "ContextScene" | "MapScene" | "DataScene" | "OutroScene" | "ChargeScene";
export type AssetType = "video" | "photo" | "map" | "motion_graphic";

export interface KenBurns {
  direction: "zoom-in" | "zoom-out";
  start_scale: number;
  end_scale: number;
}

export interface SceneData {
  sceneId: number;
  componentType: ComponentType;
  type: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  overlayText: string;
  scenePurpose: string;
  assetSrc: string | null;
  assetType: AssetType;
  kenBurns: KenBurns | null;
  geoLocation: string | null;
  // enriched fields — populated by the pipeline stage
  storyType?: string;
  eyebrowText?: string;
  statValue?: string;
  statLabel?: string;
  charges?: string[];
}

export interface OverlayProps {
  scene: SceneData;
  accentColor: string;
  delayFrames: number;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface VideoProps {
  storyType: string;
  accentColor: string;
  totalDurationSec: number;
  fps: number;
  scenes: SceneData[];
  subtitles: SubtitleCue[];
  audioSrc: string;
  brandName: string;
  jobKey: string;
}

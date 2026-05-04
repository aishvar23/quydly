import React from "react";
import { Composition, registerRoot } from "remotion";
import { ShortVideo } from "./compositions/ShortVideo";
import type { VideoProps } from "./shared/types";

const DEFAULT_PROPS: VideoProps = {
  storyType: "legal_scandal",
  accentColor: "#E84D5B",
  totalDurationSec: 36,
  fps: 30,
  audioSrc: null,
  brandName: "QUYDLY",
  jobKey: "preview",
  scenes: [
    {
      sceneId: 1,
      role: "hook",
      componentType: "HookScene",
      sceneType: "legal_documents",
      visualType: "legal_documents",
      purpose: "establish_stakes",
      startSec: 0,
      durationSec: 7,
      overlayText: "Secret files. Real stakes.",
      narration: "",
      geoLocation: null,
      asset: { kind: "branded", src: null, safetyClass: "branded" },
    },
    {
      sceneId: 2,
      role: "context",
      componentType: "ContextScene",
      sceneType: "court_institution",
      visualType: "court_institution",
      purpose: "introduce_subject",
      startSec: 7,
      durationSec: 7,
      overlayText: "Fraud charges filed",
      narration: "",
      geoLocation: null,
      asset: { kind: "branded", src: null, safetyClass: "contextual" },
    },
    {
      sceneId: 3,
      role: "detail",
      componentType: "DataScene",
      sceneType: "data_card",
      visualType: "data_card",
      purpose: "surface_key_fact",
      startSec: 14,
      durationSec: 7,
      overlayText: "5 source check",
      narration: "",
      geoLocation: null,
      asset: { kind: "data", src: null, safetyClass: "data" },
    },
    {
      sceneId: 4,
      role: "location",
      componentType: "MapScene",
      sceneType: "map_context",
      visualType: "map_context",
      purpose: "anchor_geography",
      startSec: 21,
      durationSec: 7,
      overlayText: "United States",
      narration: "",
      geoLocation: "United States",
      asset: { kind: "map", src: null, safetyClass: "map" },
    },
    {
      sceneId: 5,
      role: "outro",
      componentType: "OutroScene",
      sceneType: "outro_brand",
      visualType: "outro_brand",
      purpose: "brand_close",
      startSec: 28,
      durationSec: 4,
      overlayText: "",
      narration: "",
      geoLocation: null,
      asset: { kind: "branded", src: null, safetyClass: "branded" },
    },
  ],
  subtitles: [],
};

const RemotionRoot: React.FC = () => (
  <Composition
    id="ShortVideo"
    component={ShortVideo}
    durationInFrames={Math.ceil(DEFAULT_PROPS.totalDurationSec * DEFAULT_PROPS.fps)}
    fps={DEFAULT_PROPS.fps}
    width={1080}
    height={1920}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }: { props: VideoProps }) => ({
      durationInFrames: Math.ceil(props.totalDurationSec * props.fps),
      fps: props.fps,
      width: 1080,
      height: 1920,
    })}
  />
);

registerRoot(RemotionRoot);

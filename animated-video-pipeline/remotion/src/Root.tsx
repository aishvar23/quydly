import React from "react";
import { Composition, registerRoot } from "remotion";
import { ShortVideo } from "./compositions/ShortVideo";
import { VideoProps } from "./shared/types";

const DEFAULT_PROPS: VideoProps = {
  storyType:        "general",
  accentColor:      "#F5F5F5",
  totalDurationSec: 46,
  fps:              30,
  scenes: [
    {
      sceneId:       1,
      componentType: "HookScene",
      type:          "hook",
      startSec:      0,
      endSec:        8,
      durationSec:   8,
      overlayText:   "Secret intel. Cash bets.",
      scenePurpose:  "establish_stakes",
      assetSrc:      null,
      assetType:     "motion_graphic",
      kenBurns:      null,
      geoLocation:   null,
    },
    {
      sceneId:       2,
      componentType: "ContextScene",
      type:          "headline",
      startSec:      8,
      endSec:        18,
      durationSec:   10,
      overlayText:   "$400K in bets",
      scenePurpose:  "introduce_subject",
      assetSrc:      null,
      assetType:     "motion_graphic",
      kenBurns:      null,
      geoLocation:   null,
    },
    {
      sceneId:       3,
      componentType: "ContextScene",
      type:          "detail",
      startSec:      18,
      endSec:        28,
      durationSec:   10,
      overlayText:   "Wire fraud filed",
      scenePurpose:  "provide_detail",
      assetSrc:      null,
      assetType:     "motion_graphic",
      kenBurns:      null,
      geoLocation:   null,
    },
    {
      sceneId:       4,
      componentType: "MapScene",
      type:          "detail",
      startSec:      28,
      endSec:        36,
      durationSec:   8,
      overlayText:   "Venezuela operations",
      scenePurpose:  "provide_detail",
      assetSrc:      null,
      assetType:     "map",
      kenBurns:      null,
      geoLocation:   "Venezuela",
    },
    {
      sceneId:       5,
      componentType: "ContextScene",
      type:          "why_it_matters",
      startSec:      36,
      endSec:        42,
      durationSec:   6,
      overlayText:   "National security risk",
      scenePurpose:  "explain_impact",
      assetSrc:      null,
      assetType:     "motion_graphic",
      kenBurns:      null,
      geoLocation:   null,
    },
    {
      sceneId:       6,
      componentType: "OutroScene",
      type:          "outro",
      startSec:      42,
      endSec:        46,
      durationSec:   4,
      overlayText:   "",
      scenePurpose:  "brand_close",
      assetSrc:      null,
      assetType:     "motion_graphic",
      kenBurns:      null,
      geoLocation:   null,
    },
  ],
  subtitles: [],
  audioSrc:  "",
  brandName: "QUYDLY",
  jobKey:    "preview",
};

const RemotionRoot: React.FC = () => {
  const totalFrames = Math.ceil(DEFAULT_PROPS.totalDurationSec * DEFAULT_PROPS.fps);

  return (
    <Composition
      id="ShortVideo"
      component={ShortVideo}
      durationInFrames={totalFrames}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={({ props }: { props: VideoProps }) => ({
        durationInFrames: Math.ceil(props.totalDurationSec * props.fps),
        fps:              props.fps,
        width:            1080,
        height:           1920,
      })}
    />
  );
};

registerRoot(RemotionRoot);

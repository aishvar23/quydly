import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { SceneData } from "../shared/types";
import { OutroLockup } from "../components/OutroLockup";

interface OutroSceneProps {
  accentColor: string;
}

export const OutroScene: React.FC<OutroSceneProps> = ({ accentColor }) => {
  // Stub scene data to satisfy OverlayProps interface
  const stubScene: SceneData = {
    sceneId: -1, componentType: "OutroScene", type: "outro",
    startSec: 0, endSec: 3, durationSec: 3,
    overlayText: "", scenePurpose: "brand_close",
    assetSrc: null, assetType: "motion_graphic",
    kenBurns: null, geoLocation: null,
  };

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      <OutroLockup scene={stubScene} accentColor={accentColor} delayFrames={0} />
    </AbsoluteFill>
  );
};

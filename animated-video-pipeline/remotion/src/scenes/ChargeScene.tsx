import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { SceneData } from "../shared/types";
import { BackgroundMedia } from "../components/BackgroundMedia";
import { ChargeCard } from "../components/ChargeCard";

interface ChargeSceneProps {
  scene: SceneData;
  accentColor: string;
}

export const ChargeScene: React.FC<ChargeSceneProps> = ({ scene, accentColor }) => {
  const hasPhoto = !!scene.assetSrc && scene.assetType !== "motion_graphic";

  return (
    <AbsoluteFill style={{
      background: `linear-gradient(160deg, ${BRAND.SURFACE} 0%, ${BRAND.BG} 70%)`,
    }}>
      {/* Subtle radial glow behind card stack */}
      <div style={{
        position:     "absolute",
        top:          "32%",
        left:         "50%",
        transform:    "translate(-50%, -50%)",
        width:        520,
        height:       520,
        borderRadius: "50%",
        background:   `radial-gradient(circle, ${accentColor}10 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      {hasPhoto && (
        <BackgroundMedia
          assetSrc={scene.assetSrc}
          assetType={scene.assetType}
          kenBurns={scene.kenBurns}
        />
      )}
      {hasPhoto && (
        <AbsoluteFill style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.42) 55%, transparent 100%)",
        }} />
      )}

      <ChargeCard scene={scene} accentColor={accentColor} delayFrames={4} />
    </AbsoluteFill>
  );
};

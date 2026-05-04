import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { getSceneLayout } from "../shared/layout";
import { SceneData } from "../shared/types";
import { BackgroundMedia } from "../components/BackgroundMedia";
import { renderOverlayComponents } from "../components/ComponentRenderer";

interface DataSceneProps {
  scene: SceneData;
  accentColor: string;
}

export const DataScene: React.FC<DataSceneProps> = ({ scene, accentColor }) => {
  const layout   = getSceneLayout(scene.storyType ?? "general", scene.type);
  const hasPhoto = !!scene.assetSrc && scene.assetType !== "motion_graphic";

  return (
    <AbsoluteFill style={{
      background: `linear-gradient(160deg, ${BRAND.SURFACE} 0%, ${BRAND.BG} 70%)`,
    }}>
      {/* Accent glow blob behind text */}
      <div style={{
        position:     "absolute",
        top:          "30%",
        left:         "50%",
        transform:    "translate(-50%, -50%)",
        width:        620,
        height:       620,
        borderRadius: "50%",
        background:   `radial-gradient(circle, ${accentColor}14 0%, transparent 70%)`,
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
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.32) 55%, transparent 100%)",
        }} />
      )}

      {renderOverlayComponents(layout.components, scene, accentColor)}
    </AbsoluteFill>
  );
};

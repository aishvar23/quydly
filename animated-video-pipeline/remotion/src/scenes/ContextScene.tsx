import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { getSceneLayout } from "../shared/layout";
import { SceneData } from "../shared/types";
import { BackgroundMedia } from "../components/BackgroundMedia";
import { renderOverlayComponents } from "../components/ComponentRenderer";

interface ContextSceneProps {
  scene: SceneData;
  accentColor: string;
}

export const ContextScene: React.FC<ContextSceneProps> = ({ scene, accentColor }) => {
  const layout   = getSceneLayout(scene.storyType ?? "general", scene.type);
  const hasPhoto = !!scene.assetSrc && scene.assetType !== "motion_graphic";

  return (
    <AbsoluteFill style={{
      background: hasPhoto
        ? BRAND.BG
        : `linear-gradient(160deg, ${BRAND.SURFACE} 0%, ${BRAND.BG} 60%)`,
    }}>
      {hasPhoto && (
        <BackgroundMedia
          assetSrc={scene.assetSrc}
          assetType={scene.assetType}
          kenBurns={scene.kenBurns}
        />
      )}

      {/* Gradient scrim — lighter than hook */}
      <AbsoluteFill style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.30) 55%, transparent 100%)",
      }} />

      {renderOverlayComponents(layout.components, scene, accentColor)}
    </AbsoluteFill>
  );
};

import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { getSceneLayout } from "../shared/layout";
import { SceneData } from "../shared/types";
import { BackgroundMedia } from "../components/BackgroundMedia";
import { renderOverlayComponents } from "../components/ComponentRenderer";

interface HookSceneProps {
  scene: SceneData;
  accentColor: string;
}

export const HookScene: React.FC<HookSceneProps> = ({ scene, accentColor }) => {
  const layout = getSceneLayout(scene.storyType ?? "general", scene.type);

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      <BackgroundMedia
        assetSrc={scene.assetSrc}
        assetType={scene.assetType}
        kenBurns={scene.kenBurns}
      />

      {/* Heavier vignette — hook needs maximum text legibility */}
      <AbsoluteFill style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.50) 45%, rgba(0,0,0,0.12) 100%)",
      }} />

      {renderOverlayComponents(layout.components, scene, accentColor)}
    </AbsoluteFill>
  );
};

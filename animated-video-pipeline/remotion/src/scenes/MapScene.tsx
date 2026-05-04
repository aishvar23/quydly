import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { SceneData } from "../shared/types";
import { BackgroundMedia } from "../components/BackgroundMedia";
import { MapCallout } from "../components/MapCallout";

interface MapSceneProps {
  scene: SceneData;
  accentColor: string;
}

export const MapScene: React.FC<MapSceneProps> = ({ scene, accentColor }) => {
  const hasMap = !!scene.assetSrc;

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {hasMap ? (
        <BackgroundMedia
          assetSrc={scene.assetSrc}
          assetType={scene.assetType}
          kenBurns={scene.kenBurns ?? { direction: "zoom-in", start_scale: 1.0, end_scale: 1.04 }}
        />
      ) : (
        /* Fallback — deep radial glow when no map asset */
        <AbsoluteFill style={{
          background: `radial-gradient(ellipse at 50% 40%, ${accentColor}1C 0%, ${BRAND.BG} 68%)`,
        }} />
      )}

      {/* Map needs a strong bottom scrim to lift the label */}
      <AbsoluteFill style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.22) 50%, transparent 100%)",
      }} />

      <MapCallout scene={scene} accentColor={accentColor} delayFrames={6} />
    </AbsoluteFill>
  );
};

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { MediaBackdrop } from "../shared/media";
import { TextOverlay } from "../shared/TextOverlay";
import { BRAND, SAFE } from "../shared/brand";
import type { RenderScene } from "../shared/types";

type ContextSceneProps = {
  scene: RenderScene;
  accentColor: string;
};

export const ContextScene: React.FC<ContextSceneProps> = ({ scene, accentColor }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineX = interpolate(frame, [8, 28], [-180, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: BRAND.bg, opacity }}>
      <MediaBackdrop asset={scene.asset} accentColor={accentColor} />
      <div
        style={{
          position: "absolute",
          top: SAFE.top + 82,
          left: SAFE.left,
          transform: `translateX(${lineX}px)`,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ width: 96, height: 3, background: accentColor }} />
        <div
          style={{
            color: BRAND.muted,
            fontFamily: BRAND.fontFamily,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 0,
            textTransform: "uppercase",
          }}
        >
          {scene.role.replace(/_/g, " ")}
        </div>
      </div>
      <TextOverlay text={scene.overlayText} accentColor={accentColor} />
    </AbsoluteFill>
  );
};

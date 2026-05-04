import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { MediaBackdrop } from "../shared/media";
import { TextOverlay } from "../shared/TextOverlay";
import { BRAND } from "../shared/brand";
import type { RenderScene } from "../shared/types";

type HookSceneProps = {
  scene: RenderScene;
  accentColor: string;
};

export const HookScene: React.FC<HookSceneProps> = ({ scene, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rule = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 24, stiffness: 90, mass: 0.9 },
    durationInFrames: 22,
  });
  const ruleWidth = interpolate(rule, [0, 1], [0, BRAND.width * 0.72]);

  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      <MediaBackdrop asset={scene.asset} accentColor={accentColor} intensity="hero" />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 1110,
          width: ruleWidth,
          height: 4,
          background: accentColor,
        }}
      />
      <TextOverlay
        text={scene.overlayText}
        accentColor={accentColor}
        mode="hook"
        label="Developing context"
      />
    </AbsoluteFill>
  );
};

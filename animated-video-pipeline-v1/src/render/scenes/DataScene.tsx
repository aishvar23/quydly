import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TextOverlay } from "../shared/TextOverlay";
import { BRAND, SAFE } from "../shared/brand";
import type { RenderScene } from "../shared/types";

type DataSceneProps = {
  scene: RenderScene;
  accentColor: string;
};

export const DataScene: React.FC<DataSceneProps> = ({ scene, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 24, stiffness: 90, mass: 0.9 },
    durationInFrames: 22,
  });
  const y = interpolate(enter, [0, 1], [48, 0]);
  const width = interpolate(frame, [8, 34], [0, 360], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bars = [0.54, 0.78, 0.42, 0.66].map((target, index) =>
    interpolate(frame, [12 + index * 4, 32 + index * 4], [0.08, target], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(155deg, ${BRAND.surface2} 0%, ${BRAND.bg} 70%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          right: SAFE.right,
          top: 360,
          height: 470,
          transform: `translateY(${y}px)`,
        }}
      >
        <div
          style={{
            color: accentColor,
            fontFamily: BRAND.fontFamily,
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: 0,
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          Key figure
        </div>
        <div
          style={{
            width,
            height: 4,
            background: accentColor,
            marginBottom: 42,
          }}
        />
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", height: 260 }}>
          {bars.map((scale, index) => (
            <div
              key={index}
              style={{
                width: 92,
                height: 260 * scale,
                background: index === 1 ? accentColor : "rgba(255,255,255,0.22)",
                borderRadius: 6,
              }}
            />
          ))}
        </div>
      </div>
      <TextOverlay
        text={scene.overlayText}
        accentColor={accentColor}
        mode="data"
        label={scene.purpose || "Data point"}
      />
    </AbsoluteFill>
  );
};

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND } from "../shared/brand";

type OutroSceneProps = {
  accentColor: string;
};

export const OutroScene: React.FC<OutroSceneProps> = ({ accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 80, mass: 1 },
    durationInFrames: 24,
  });
  const scale = interpolate(enter, [0, 1], [0.94, 1]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const line = interpolate(frame, [10, 34], [0, 220], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: BRAND.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(90deg, ${accentColor}22 1px, transparent 1px)`,
          backgroundSize: "84px 84px",
          opacity: 0.18,
        }}
      />
      <div
        style={{
          transform: `scale(${scale})`,
          opacity,
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: BRAND.text,
            fontFamily: BRAND.fontFamily,
            fontSize: 104,
            fontWeight: 900,
            letterSpacing: 0,
          }}
        >
          {BRAND.name}
        </div>
        <div
          style={{
            width: line,
            height: 5,
            background: accentColor,
            margin: "22px auto 0",
            borderRadius: 3,
          }}
        />
        <div
          style={{
            color: BRAND.muted,
            fontFamily: BRAND.fontFamily,
            fontSize: 33,
            fontWeight: 600,
            marginTop: 26,
            letterSpacing: 0,
            textTransform: "uppercase",
          }}
        >
          Daily news, made usable
        </div>
      </div>
    </AbsoluteFill>
  );
};

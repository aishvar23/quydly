import React from "react";
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND, SAFE, TIMING } from "./brand";

type TextOverlayProps = {
  text: string;
  accentColor: string;
  mode?: "hook" | "strap" | "data";
  label?: string;
};

export const TextOverlay: React.FC<TextOverlayProps> = ({
  text,
  accentColor,
  mode = "strap",
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 22, stiffness: 105, mass: 0.8 },
    durationInFrames: 18,
  });
  const opacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...TIMING.smooth),
  });
  const y = interpolate(enter, [0, 1], [34, 0]);
  const fontSize = fittedFontSize(text, mode);

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left,
        right: SAFE.right,
        bottom: mode === "hook" ? SAFE.bottom + 72 : SAFE.bottom,
        transform: `translateY(${y}px)`,
        opacity,
      }}
    >
      {label ? (
        <div
          style={{
            color: accentColor,
            fontFamily: BRAND.fontFamily,
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: 0,
            marginBottom: 16,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 22,
        }}
      >
        <div
          style={{
            width: mode === "hook" ? 9 : 6,
            background: accentColor,
            borderRadius: 3,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            background: mode === "hook" ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.58)",
            border: `1px solid ${accentColor}55`,
            borderRadius: 6,
            padding: mode === "hook" ? "28px 30px" : "20px 24px",
            maxWidth: "100%",
          }}
        >
          <div
            style={{
              color: BRAND.text,
              fontFamily: BRAND.fontFamily,
              fontSize,
              fontWeight: 850,
              lineHeight: 1.04,
              letterSpacing: 0,
              textTransform: "uppercase",
              overflowWrap: "break-word",
            }}
          >
            {text}
          </div>
        </div>
      </div>
    </div>
  );
};

function fittedFontSize(text: string, mode: "hook" | "strap" | "data"): number {
  const words = text.split(/\s+/).filter(Boolean);
  const longest = words.reduce((max, word) => Math.max(max, word.length), 1);
  const base = mode === "hook" ? 82 : mode === "data" ? 96 : 54;
  const byLength = Math.floor(800 / Math.max(longest * 0.62, 8));
  const max = mode === "data" ? 104 : base;
  const min = mode === "hook" ? 52 : 38;
  return Math.max(min, Math.min(max, byLength));
}

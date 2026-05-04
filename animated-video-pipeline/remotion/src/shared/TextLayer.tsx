import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, SAFE } from "./brand";

interface TextLayerProps {
  text: string;
  accentColor: string;
  isHook?: boolean;
  delayFrames?: number;
}

export const TextLayer: React.FC<TextLayerProps> = ({
  text,
  accentColor,
  isHook = false,
  delayFrames = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterProgress = spring({
    frame: Math.max(0, frame - delayFrames),
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.7 },
    durationInFrames: 18,
  });

  const translateY = interpolate(enterProgress, [0, 1], [40, 0]);
  const opacity    = interpolate(enterProgress, [0, 1], [0, 1]);

  const fontSize   = isHook ? BRAND.HOOK_FONT_SIZE   : BRAND.STRAP_FONT_SIZE;
  const lineHeight = isHook ? BRAND.HOOK_LINE_HEIGHT  : BRAND.STRAP_LINE_HEIGHT;
  const padV       = isHook ? 24 : 16;
  const padH       = isHook ? 32 : 24;

  return (
    <div
      style={{
        position:    "absolute",
        bottom:      isHook ? SAFE.BOTTOM + 80 : SAFE.BOTTOM,
        left:        SAFE.SIDE,
        right:       SAFE.SIDE,
        opacity,
        transform:   `translateY(${translateY}px)`,
      }}
    >
      {/* Accent bar above text */}
      <div
        style={{
          width:           isHook ? 8 : 5,
          height:          fontSize * lineHeight,
          background:      accentColor,
          position:        "absolute",
          left:            -padH,
          top:             padV,
          borderRadius:    2,
        }}
      />

      <div
        style={{
          background:      isHook ? BRAND.OVERLAY_DARK : BRAND.OVERLAY_MEDIUM,
          padding:         `${padV}px ${padH}px`,
          borderRadius:    6,
        }}
      >
        <p
          style={{
            fontFamily:    BRAND.FONT_FAMILY,
            fontSize:      fontSize,
            fontWeight:    BRAND.FONT_WEIGHT_BOLD,
            lineHeight:    lineHeight,
            color:         BRAND.TEXT_PRIMARY,
            margin:        0,
            textTransform: "uppercase",
            letterSpacing: isHook ? "-0.02em" : "-0.01em",
          }}
        >
          {text}
        </p>
      </div>
    </div>
  );
};

import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { useWipe, useTextRise, useFadeIn } from "../shared/animations";
import { getEyebrow } from "../shared/layout";
import { OverlayProps } from "../shared/types";

export const HookStrap: React.FC<OverlayProps> = ({ scene, accentColor, delayFrames }) => {
  const eyebrow = scene.eyebrowText ?? getEyebrow(scene.scenePurpose);
  const barWipe       = useWipe(delayFrames, 14);
  const eyebrowOpacity = useFadeIn(delayFrames, 10);
  const { translatePct, opacity } = useTextRise(delayFrames + 8);

  return (
    <div style={{
      position: "absolute",
      bottom: SAFE.BOTTOM + 80,
      left: SAFE.SIDE,
      right: SAFE.SIDE,
    }}>
      {/* Eyebrow */}
      {eyebrow && (
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      22,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        "0 0 14px 0",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          opacity:       eyebrowOpacity,
        }}>{eyebrow}</p>
      )}

      {/* Accent wipe bar */}
      <div style={{
        width:        `${barWipe * 100}%`,
        height:       3,
        background:   accentColor,
        borderRadius: 2,
        marginBottom: 22,
      }} />

      {/* Clip-mask text rise — overflow hidden clips text until it slides into view */}
      <div style={{ overflow: "hidden", paddingBottom: 10 }}>
        <p style={{
          fontFamily:  BRAND.FONT_FAMILY,
          fontSize:    BRAND.HOOK_FONT_SIZE,
          fontWeight:  BRAND.FONT_WEIGHT_BOLD,
          color:       BRAND.TEXT_PRIMARY,
          margin:      0,
          lineHeight:  BRAND.HOOK_LINE_HEIGHT,
          transform:   `translateY(${translatePct}%)`,
          opacity,
          textShadow:  "0 2px 20px rgba(0,0,0,0.75)",
        }}>{scene.overlayText}</p>
      </div>
    </div>
  );
};

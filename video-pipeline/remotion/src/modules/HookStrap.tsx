import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useWipe, useTextRise, useFadeIn } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const HookStrap: React.FC<Props> = ({ module, accentColor }) => {
  const eyebrow            = module.eyebrow || "BREAKING";
  const hookText           = module.hookText || "";
  const barWipe            = useWipe(5, 14);
  const eyebrowOpacity     = useFadeIn(5, 10);
  const { translatePct, opacity } = useTextRise(13);

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Gradient — heavier at bottom for text legibility */}
      <AbsoluteFill style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.60) 40%, rgba(0,0,0,0.18) 100%)",
      }} />

      {/* Subtle radial glow */}
      <div style={{
        position:     "absolute",
        bottom:       -200,
        left:         "50%",
        transform:    "translateX(-50%)",
        width:        900,
        height:       900,
        borderRadius: "50%",
        background:   `radial-gradient(circle, ${accentColor}18 0%, transparent 65%)`,
        pointerEvents: "none",
      }} />

      <div style={{
        position: "absolute",
        bottom:   SAFE.BOTTOM + 80,
        left:     SAFE.SIDE,
        right:    SAFE.SIDE,
      }}>
        {/* Eyebrow */}
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

        {/* Accent wipe bar */}
        <div style={{
          width:        `${barWipe * 100}%`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 22,
        }} />

        {/* Hook text — clip-mask rise */}
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
          }}>{hookText}</p>
        </div>
      </div>
    </AbsoluteFill>
  );
};

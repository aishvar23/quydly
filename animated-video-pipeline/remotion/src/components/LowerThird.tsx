import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { useWipe, useTextRise, useFadeIn } from "../shared/animations";
import { getEyebrow } from "../shared/layout";
import { OverlayProps } from "../shared/types";

export const LowerThird: React.FC<OverlayProps> = ({ scene, accentColor, delayFrames }) => {
  const eyebrow        = scene.eyebrowText ?? getEyebrow(scene.scenePurpose);
  const barWipe        = useWipe(delayFrames, 12);
  const eyebrowOpacity = useFadeIn(delayFrames + 3, 10);
  const { translatePct, opacity } = useTextRise(delayFrames + 6);

  const barHeight = barWipe * 84;

  return (
    <div style={{
      position:   "absolute",
      bottom:     SAFE.BOTTOM,
      left:       SAFE.SIDE,
      right:      SAFE.SIDE,
      display:    "flex",
      alignItems: "flex-start",
      gap:        22,
    }}>
      {/* Left accent bar animates to full height via wipe */}
      <div style={{
        width:        4,
        height:       barHeight,
        background:   accentColor,
        borderRadius: 2,
        flexShrink:   0,
        marginTop:    eyebrow ? 28 : 8,
      }} />

      <div style={{ flex: 1 }}>
        {/* Eyebrow label */}
        {eyebrow && (
          <p style={{
            fontFamily:    BRAND.FONT_FAMILY,
            fontSize:      20,
            fontWeight:    BRAND.FONT_WEIGHT_MED,
            color:         accentColor,
            margin:        "0 0 12px 0",
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            opacity:       eyebrowOpacity,
          }}>{eyebrow}</p>
        )}

        {/* Clip-mask main text reveal */}
        <div style={{ overflow: "hidden", paddingBottom: 6 }}>
          <p style={{
            fontFamily: BRAND.FONT_FAMILY,
            fontSize:   BRAND.STRAP_FONT_SIZE,
            fontWeight: BRAND.FONT_WEIGHT_BOLD,
            color:      BRAND.TEXT_PRIMARY,
            margin:     0,
            lineHeight: BRAND.STRAP_LINE_HEIGHT,
            transform:  `translateY(${translatePct}%)`,
            opacity,
          }}>{scene.overlayText}</p>
        </div>
      </div>
    </div>
  );
};

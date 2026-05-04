import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { useSlideFromBottom, useFadeIn } from "../shared/animations";
import { getEyebrow } from "../shared/layout";
import { OverlayProps } from "../shared/types";

export const ContextPanel: React.FC<OverlayProps> = ({ scene, accentColor, delayFrames }) => {
  const eyebrow = scene.eyebrowText ?? getEyebrow(scene.scenePurpose);
  const { y, opacity: panelOpacity } = useSlideFromBottom(delayFrames, 50);
  const textOpacity = useFadeIn(delayFrames + 7, 14);

  return (
    <div style={{
      position:   "absolute",
      bottom:     0,
      left:       0,
      right:      0,
      padding:    `36px ${SAFE.SIDE}px ${SAFE.BOTTOM}px`,
      background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.64) 55%, transparent 100%)",
      transform:  `translateY(${y}px)`,
      opacity:    panelOpacity,
    }}>
      {/* Eyebrow row with left accent dot */}
      <div style={{
        display:    "flex",
        alignItems: "center",
        gap:        14,
        marginBottom: 18,
      }}>
        <div style={{
          width:        3,
          height:       26,
          background:   accentColor,
          borderRadius: 2,
          flexShrink:   0,
        }} />
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      18,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        0,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          opacity:       textOpacity,
        }}>{eyebrow || "WHY IT MATTERS"}</p>
      </div>

      {/* Main context text */}
      <p style={{
        fontFamily: BRAND.FONT_FAMILY,
        fontSize:   46,
        fontWeight: BRAND.FONT_WEIGHT_BOLD,
        color:      BRAND.TEXT_PRIMARY,
        margin:     0,
        lineHeight: 1.2,
        opacity:    textOpacity,
      }}>{scene.overlayText}</p>
    </div>
  );
};

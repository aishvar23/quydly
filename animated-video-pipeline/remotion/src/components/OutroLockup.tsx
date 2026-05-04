import React from "react";
import { BRAND } from "../shared/brand";
import { useWipe, useScaleIn, useFadeIn } from "../shared/animations";
import { OverlayProps } from "../shared/types";

export const OutroLockup: React.FC<OverlayProps> = ({ accentColor, delayFrames }) => {
  const { scale, opacity } = useScaleIn(delayFrames, 0.88, { damping: 18, stiffness: 80, mass: 1.1 });
  const barWipe        = useWipe(delayFrames + 12, 22);
  const taglineOpacity = useFadeIn(delayFrames + 24, 14);

  return (
    <div style={{
      position:       "absolute",
      inset:          0,
      display:        "flex",
      flexDirection:  "column",
      alignItems:     "center",
      justifyContent: "center",
    }}>
      {/* Radial accent glow */}
      <div style={{
        position:     "absolute",
        top:          "50%",
        left:         "50%",
        transform:    "translate(-50%, -50%)",
        width:        820,
        height:       820,
        borderRadius: "50%",
        background:   `radial-gradient(circle, ${accentColor}14 0%, transparent 65%)`,
        pointerEvents: "none",
      }} />

      <div style={{
        display:       "flex",
        flexDirection: "column",
        alignItems:    "center",
        transform:     `scale(${scale})`,
        opacity,
      }}>
        {/* Brand name */}
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      110,
          fontWeight:    BRAND.FONT_WEIGHT_BOLD,
          color:         BRAND.TEXT_PRIMARY,
          margin:        0,
          letterSpacing: "0.24em",
          lineHeight:    1,
        }}>{BRAND.NAME}</p>

        {/* Wipe underbar */}
        <div style={{
          width:        barWipe * 134,
          height:       4,
          background:   accentColor,
          borderRadius: 2,
          marginTop:    18,
        }} />

        {/* Tagline */}
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      30,
          fontWeight:    BRAND.FONT_WEIGHT_REG,
          color:         BRAND.TEXT_SECONDARY,
          margin:        "26px 0 0 0",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity:       taglineOpacity,
        }}>Your daily news, explained.</p>
      </div>
    </div>
  );
};

import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { useFadeIn, useScaleIn, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const OutroLockup: React.FC<Props> = ({ accentColor }) => {
  const { scale, opacity } = useScaleIn(4, 0.82);
  const barWipe  = useWipe(14, 20);
  const taglineOp = useFadeIn(24, 16);
  const glowOp    = useFadeIn(0, 24);

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Centered radial glow */}
      <AbsoluteFill style={{
        background:   `radial-gradient(ellipse at center, ${accentColor}1A 0%, transparent 62%)`,
        opacity:      glowOp,
        pointerEvents: "none",
      }} />

      <AbsoluteFill style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        gap:            0,
      }}>
        {/* Brand name */}
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      110,
          fontWeight:    BRAND.FONT_WEIGHT_BOLD,
          color:         BRAND.TEXT_PRIMARY,
          margin:        0,
          letterSpacing: "0.24em",
          textTransform: "uppercase",
          transform:     `scale(${scale})`,
          opacity,
        }}>QUYDLY</p>

        {/* Wipe underbar */}
        <div style={{
          width:        `${barWipe * 220}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginTop:    18,
          marginBottom: 22,
        }} />

        {/* Tagline */}
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      28,
          fontWeight:    BRAND.FONT_WEIGHT_REG,
          color:         BRAND.TEXT_SECONDARY,
          margin:        0,
          letterSpacing: "0.10em",
          opacity:       taglineOp,
        }}>Your daily news, explained.</p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

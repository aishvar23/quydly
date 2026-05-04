import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useFadeIn, useScaleIn, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const PlatformCard: React.FC<Props> = ({ module, accentColor }) => {
  const { scale, opacity } = useScaleIn(4, 0.90);
  const barWipe   = useWipe(4, 16);
  const descOp    = useFadeIn(18, 14);
  const eyebrowOp = useFadeIn(4, 10);

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Corner accent geometry */}
      <div style={{
        position:  "absolute",
        top:       0,
        right:     0,
        width:     "45%",
        height:    "50%",
        background: `linear-gradient(225deg, ${accentColor}12 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div style={{
        position: "absolute",
        bottom:   SAFE.BOTTOM,
        left:     SAFE.SIDE,
        right:    SAFE.SIDE,
      }}>
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      20,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        "0 0 10px 0",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          opacity:       eyebrowOp,
        }}>PLATFORM</p>

        <div style={{
          width:        `${barWipe * 80}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 24,
        }} />

        {/* Platform name — scale in */}
        <p style={{
          fontFamily:      BRAND.FONT_FAMILY,
          fontSize:        BRAND.STRAP_FONT_SIZE + 12,
          fontWeight:      BRAND.FONT_WEIGHT_BOLD,
          color:           BRAND.TEXT_PRIMARY,
          margin:          "0 0 16px 0",
          lineHeight:      1.0,
          letterSpacing:   "0.02em",
          transform:       `scale(${scale})`,
          transformOrigin: "left bottom",
          opacity,
        }}>{module.platformName || "Platform"}</p>

        <p style={{
          fontFamily:  BRAND.FONT_FAMILY,
          fontSize:    32,
          fontWeight:  BRAND.FONT_WEIGHT_REG,
          color:       BRAND.TEXT_SECONDARY,
          margin:      0,
          lineHeight:  1.4,
          opacity:     descOp,
        }}>{module.platformDescription || ""}</p>
      </div>
    </AbsoluteFill>
  );
};

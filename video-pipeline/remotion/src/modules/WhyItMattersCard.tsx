import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useFadeIn, useTextRise, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const WhyItMattersCard: React.FC<Props> = ({ module, accentColor }) => {
  const eyebrowOp  = useFadeIn(4, 10);
  const barWipe    = useWipe(4, 16);
  const textRise   = useTextRise(14);
  const supportOp  = useFadeIn(26, 14);

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Accent tint from bottom */}
      <AbsoluteFill style={{
        background: `linear-gradient(to top, ${accentColor}14 0%, transparent 55%)`,
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
        }}>WHY IT MATTERS</p>

        <div style={{
          width:        `${barWipe * 80}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 24,
        }} />

        {/* Clip-mask text rise */}
        <div style={{ overflow: "hidden", paddingBottom: 8 }}>
          <p style={{
            fontFamily:  BRAND.FONT_FAMILY,
            fontSize:    BRAND.STRAP_FONT_SIZE + 4,
            fontWeight:  BRAND.FONT_WEIGHT_BOLD,
            color:       BRAND.TEXT_PRIMARY,
            margin:      "0 0 20px 0",
            lineHeight:  1.15,
            transform:   `translateY(${textRise.translatePct}%)`,
            opacity:     textRise.opacity,
          }}>{module.implicationText || "This changes everything."}</p>
        </div>

        {module.supportingPhrase && (
          <p style={{
            fontFamily:  BRAND.FONT_FAMILY,
            fontSize:    32,
            fontWeight:  BRAND.FONT_WEIGHT_REG,
            color:       BRAND.TEXT_SECONDARY,
            margin:      0,
            lineHeight:  1.4,
            opacity:     supportOp,
          }}>{module.supportingPhrase}</p>
        )}
      </div>
    </AbsoluteFill>
  );
};

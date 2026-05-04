import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useFadeIn, useTextRise, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const PersonCard: React.FC<Props> = ({ module, accentColor }) => {
  const barWipe   = useWipe(4, 16);
  const eyebrowOp = useFadeIn(4, 10);
  const nameRise  = useTextRise(10);
  const roleOp    = useFadeIn(18, 12);
  const affOp     = useFadeIn(24, 10);

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      <AbsoluteFill style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.18) 100%)",
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
          margin:        "0 0 12px 0",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          opacity:       eyebrowOp,
        }}>PERSON OF INTEREST</p>

        <div style={{
          width:        `${barWipe * 80}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 20,
        }} />

        <div style={{ overflow: "hidden", paddingBottom: 8 }}>
          <p style={{
            fontFamily:  BRAND.FONT_FAMILY,
            fontSize:    72,
            fontWeight:  BRAND.FONT_WEIGHT_BOLD,
            color:       BRAND.TEXT_PRIMARY,
            margin:      "0 0 12px 0",
            lineHeight:  1.0,
            transform:   `translateY(${nameRise.translatePct}%)`,
            opacity:     nameRise.opacity,
          }}>{module.name || "Unknown"}</p>
        </div>

        <p style={{
          fontFamily:  BRAND.FONT_FAMILY,
          fontSize:    38,
          fontWeight:  BRAND.FONT_WEIGHT_MED,
          color:       accentColor,
          margin:      "0 0 10px 0",
          lineHeight:  1.2,
          opacity:     roleOp,
        }}>{module.role || ""}</p>

        {module.affiliation && (
          <p style={{
            fontFamily:  BRAND.FONT_FAMILY,
            fontSize:    28,
            fontWeight:  BRAND.FONT_WEIGHT_REG,
            color:       BRAND.TEXT_SECONDARY,
            margin:      0,
            opacity:     affOp,
          }}>{module.affiliation}</p>
        )}
      </div>
    </AbsoluteFill>
  );
};

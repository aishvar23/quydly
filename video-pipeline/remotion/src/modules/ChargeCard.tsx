import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useSlideFromRight, useFadeIn, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

const ChargeRow: React.FC<{ text: string; index: number; accentColor: string }> = ({ text, index, accentColor }) => {
  const { x, opacity } = useSlideFromRight(4 + index * 9, 90);
  return (
    <div style={{
      display:      "flex",
      alignItems:   "center",
      gap:          18,
      marginBottom: 20,
      transform:    `translateX(${x}px)`,
      opacity,
    }}>
      <div style={{ width: 4, height: 46, background: accentColor, borderRadius: 2, flexShrink: 0 }} />
      <p style={{
        fontFamily:  BRAND.FONT_FAMILY,
        fontSize:    38,
        fontWeight:  BRAND.FONT_WEIGHT_MED,
        color:       BRAND.TEXT_PRIMARY,
        margin:      0,
        lineHeight:  1.2,
      }}>{text}</p>
    </div>
  );
};

export const ChargeCard: React.FC<Props> = ({ module, accentColor }) => {
  const eyebrowOp = useFadeIn(4, 10);
  const barWipe   = useWipe(4, 16);
  const charges   = module.charges && module.charges.length > 0
    ? module.charges
    : ["Charges filed"];

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
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
        }}>{module.authorityLabel || "CHARGES FILED"}</p>

        <div style={{
          width:        `${barWipe * 80}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 24,
        }} />

        {charges.map((charge, i) => (
          <ChargeRow key={i} text={charge} index={i} accentColor={accentColor} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

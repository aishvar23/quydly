import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useFadeIn, useSlideFromBottom, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

const Chip: React.FC<{ text: string; accentColor: string; delay: number }> = ({ text, accentColor, delay }) => {
  const opacity = useFadeIn(delay, 10);
  return (
    <div style={{
      display:      "inline-flex",
      alignItems:   "center",
      padding:      "6px 16px",
      borderRadius: 4,
      border:       `1.5px solid ${accentColor}55`,
      background:   `${accentColor}12`,
      marginRight:  10,
      marginBottom: 8,
      opacity,
    }}>
      <span style={{
        fontFamily:    BRAND.FONT_FAMILY,
        fontSize:      20,
        fontWeight:    BRAND.FONT_WEIGHT_MED,
        color:         accentColor,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}>{text}</span>
    </div>
  );
};

export const DossierCard: React.FC<Props> = ({ module, accentColor }) => {
  const { y, opacity } = useSlideFromBottom(4, 44);
  const barWipe         = useWipe(4, 18);
  const categoryOpacity = useFadeIn(4, 10);
  const subjectOpacity  = useFadeIn(10, 12);
  const chips           = module.chips || [];

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Diagonal tint accent */}
      <div style={{
        position:  "absolute",
        top:       0,
        right:     0,
        width:     "35%",
        height:    "60%",
        background: `linear-gradient(135deg, transparent 0%, ${accentColor}08 100%)`,
        pointerEvents: "none",
      }} />

      <div style={{
        position:  "absolute",
        bottom:    SAFE.BOTTOM,
        left:      SAFE.SIDE,
        right:     SAFE.SIDE,
        transform: `translateY(${y}px)`,
        opacity,
      }}>
        {/* Category eyebrow */}
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      20,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        "0 0 10px 0",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          opacity:       categoryOpacity,
        }}>{module.category || "INVESTIGATION"}</p>

        {/* Accent bar wipe */}
        <div style={{
          width:        `${barWipe * 90}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 20,
        }} />

        {/* Case title */}
        <p style={{
          fontFamily:  BRAND.FONT_FAMILY,
          fontSize:    BRAND.STRAP_FONT_SIZE,
          fontWeight:  BRAND.FONT_WEIGHT_BOLD,
          color:       BRAND.TEXT_PRIMARY,
          margin:      "0 0 12px 0",
          lineHeight:  1.1,
        }}>{module.caseTitle || "Case File"}</p>

        {/* Subject */}
        <p style={{
          fontFamily:  BRAND.FONT_FAMILY,
          fontSize:    36,
          fontWeight:  BRAND.FONT_WEIGHT_MED,
          color:       BRAND.TEXT_SECONDARY,
          margin:      "0 0 24px 0",
          lineHeight:  1.2,
          opacity:     subjectOpacity,
        }}>{module.subject || ""}</p>

        {/* Chips */}
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {chips.map((chip, i) => (
            <Chip key={i} text={chip} accentColor={accentColor} delay={16 + i * 6} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

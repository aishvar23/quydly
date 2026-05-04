import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useFadeIn, useSlideFromBottom, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

const Beat: React.FC<{
  label: string; text: string; index: number; accentColor: string; isLast: boolean;
}> = ({ label, text, index, accentColor, isLast }) => {
  const { y, opacity } = useSlideFromBottom(6 + index * 12, 30);

  return (
    <div style={{
      display:      "flex",
      gap:          20,
      marginBottom: isLast ? 0 : 28,
      transform:    `translateY(${y}px)`,
      opacity,
    }}>
      {/* Timeline track */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{ width: 12, height: 12, borderRadius: "50%", background: accentColor, marginTop: 6 }} />
        {!isLast && (
          <div style={{ width: 2, flex: 1, background: `${accentColor}40`, marginTop: 6 }} />
        )}
      </div>

      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 4 }}>
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      18,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        "0 0 4px 0",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}>{label}</p>
        <p style={{
          fontFamily:  BRAND.FONT_FAMILY,
          fontSize:    30,
          fontWeight:  BRAND.FONT_WEIGHT_REG,
          color:       BRAND.TEXT_PRIMARY,
          margin:      0,
          lineHeight:  1.3,
        }}>{text}</p>
      </div>
    </div>
  );
};

export const TimelineCard: React.FC<Props> = ({ module, accentColor }) => {
  const { y, opacity } = useSlideFromBottom(4, 44);
  const eyebrowOp      = useFadeIn(4, 10);
  const barWipe        = useWipe(4, 16);
  const beats          = module.beats && module.beats.length > 0
    ? module.beats.slice(0, 4)
    : [{ label: "EVENT", text: "No timeline available" }];

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      <div style={{
        position:  "absolute",
        bottom:    SAFE.BOTTOM,
        left:      SAFE.SIDE,
        right:     SAFE.SIDE,
        transform: `translateY(${y}px)`,
        opacity,
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
        }}>TIMELINE</p>

        <div style={{
          width:        `${barWipe * 80}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 28,
        }} />

        {beats.map((beat, i) => (
          <Beat
            key={i}
            label={beat.label}
            text={beat.text}
            index={i}
            accentColor={accentColor}
            isLast={i === beats.length - 1}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

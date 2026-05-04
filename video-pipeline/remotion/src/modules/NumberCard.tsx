import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useSpringEntrance, useFadeIn, useWipe } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const NumberCard: React.FC<Props> = ({ module, accentColor }) => {
  const entrance = useSpringEntrance(4);
  const barWipe  = useWipe(4, 16);
  const labelOp  = useFadeIn(14, 12);
  const secOp    = useFadeIn(22, 10);

  const scale   = interpolate(entrance, [0, 1], [0.88, 1.0]);
  const opacity = interpolate(entrance, [0, 0.25], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Radial glow */}
      <div style={{
        position:     "absolute",
        top:          "30%",
        left:         "50%",
        transform:    "translate(-50%, -50%)",
        width:        680,
        height:       680,
        borderRadius: "50%",
        background:   `radial-gradient(circle, ${accentColor}10 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div style={{
        position:       "absolute",
        inset:          0,
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "flex-start",
        justifyContent: "flex-end",
        padding:        `0 ${SAFE.SIDE}px ${SAFE.BOTTOM}px`,
      }}>
        {/* Accent wipe bar */}
        <div style={{
          width:        `${barWipe * 80}px`,
          height:       3,
          background:   accentColor,
          borderRadius: 2,
          marginBottom: 24,
        }} />

        {/* Main number — scale in */}
        <p style={{
          fontFamily:      BRAND.FONT_FAMILY,
          fontSize:        140,
          fontWeight:      BRAND.FONT_WEIGHT_BOLD,
          color:           BRAND.TEXT_PRIMARY,
          margin:          "0 0 4px 0",
          lineHeight:      1,
          letterSpacing:   "-0.02em",
          transform:       `scale(${scale})`,
          transformOrigin: "left center",
          opacity,
        }}>{module.mainNumber || "—"}</p>

        {/* Label */}
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      36,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        "0 0 16px 0",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          opacity:       labelOp,
        }}>{module.numberLabel || ""}</p>

        {/* Secondary metric */}
        {module.secondaryMetric && (
          <p style={{
            fontFamily:  BRAND.FONT_FAMILY,
            fontSize:    28,
            fontWeight:  BRAND.FONT_WEIGHT_REG,
            color:       BRAND.TEXT_SECONDARY,
            margin:      0,
            opacity:     secOp,
          }}>{module.secondaryMetric}</p>
        )}
      </div>
    </AbsoluteFill>
  );
};

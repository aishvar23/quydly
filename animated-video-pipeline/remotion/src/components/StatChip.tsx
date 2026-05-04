import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { useScaleIn } from "../shared/animations";
import { parseStatFromOverlay } from "../shared/layout";
import { OverlayProps } from "../shared/types";

export const StatChip: React.FC<OverlayProps> = ({ scene, accentColor, delayFrames }) => {
  const stat = (scene.statValue)
    ? { value: scene.statValue, label: scene.statLabel ?? "" }
    : parseStatFromOverlay(scene.overlayText);

  const { scale, opacity } = useScaleIn(
    delayFrames,
    0.65,
    { damping: 16, stiffness: 150, mass: 0.65 }
  );

  if (!stat) return null;

  return (
    <div style={{
      position:        "absolute",
      top:             SAFE.TOP + 24,
      right:           SAFE.SIDE,
      transform:       `scale(${scale})`,
      transformOrigin: "top right",
      opacity,
    }}>
      <div style={{
        background:    `${accentColor}1E`,
        border:        `1.5px solid ${accentColor}55`,
        borderRadius:  18,
        padding:       "20px 28px",
        backdropFilter: "blur(10px)",
        display:       "flex",
        flexDirection: "column",
        alignItems:    "center",
        minWidth:      148,
      }}>
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      54,
          fontWeight:    BRAND.FONT_WEIGHT_BOLD,
          color:         accentColor,
          margin:        0,
          lineHeight:    1,
          letterSpacing: "-0.02em",
        }}>{stat.value}</p>
        {stat.label && (
          <p style={{
            fontFamily:    BRAND.FONT_FAMILY,
            fontSize:      15,
            fontWeight:    BRAND.FONT_WEIGHT_MED,
            color:         BRAND.TEXT_SECONDARY,
            margin:        "9px 0 0 0",
            letterSpacing: "0.13em",
            textTransform: "uppercase",
          }}>{stat.label}</p>
        )}
      </div>
    </div>
  );
};

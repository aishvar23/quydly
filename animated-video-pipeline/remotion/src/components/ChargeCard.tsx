import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { useSlideFromRight, useFadeIn } from "../shared/animations";
import { getEyebrow } from "../shared/layout";
import { OverlayProps } from "../shared/types";

interface CardRowProps {
  text: string;
  index: number;
  accentColor: string;
  baseDelay: number;
}

const CardRow: React.FC<CardRowProps> = ({ text, index, accentColor, baseDelay }) => {
  const { x, opacity } = useSlideFromRight(baseDelay + index * 9, 90);
  return (
    <div style={{
      display:       "flex",
      alignItems:    "center",
      gap:           18,
      marginBottom:  18,
      transform:     `translateX(${x}px)`,
      opacity,
    }}>
      <div style={{
        width:        4,
        height:       46,
        background:   accentColor,
        borderRadius: 2,
        flexShrink:   0,
      }} />
      <p style={{
        fontFamily: BRAND.FONT_FAMILY,
        fontSize:   38,
        fontWeight: BRAND.FONT_WEIGHT_MED,
        color:      BRAND.TEXT_PRIMARY,
        margin:     0,
        lineHeight: 1.2,
      }}>{text}</p>
    </div>
  );
};

export const ChargeCard: React.FC<OverlayProps> = ({ scene, accentColor, delayFrames }) => {
  const eyebrow        = scene.eyebrowText ?? getEyebrow(scene.scenePurpose);
  const eyebrowOpacity = useFadeIn(delayFrames, 10);

  const charges = (scene.charges && scene.charges.length > 0)
    ? scene.charges
    : [scene.overlayText].filter(Boolean);

  return (
    <div style={{
      position: "absolute",
      bottom:   SAFE.BOTTOM,
      left:     SAFE.SIDE,
      right:    SAFE.SIDE,
    }}>
      {eyebrow && (
        <p style={{
          fontFamily:    BRAND.FONT_FAMILY,
          fontSize:      20,
          fontWeight:    BRAND.FONT_WEIGHT_MED,
          color:         accentColor,
          margin:        "0 0 22px 0",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          opacity:       eyebrowOpacity,
        }}>{eyebrow}</p>
      )}
      {charges.map((charge, i) => (
        <CardRow
          key={i}
          text={charge}
          index={i}
          accentColor={accentColor}
          baseDelay={delayFrames + 4}
        />
      ))}
    </div>
  );
};

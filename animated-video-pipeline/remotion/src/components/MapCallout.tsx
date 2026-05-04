import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { useSlideFromBottom, usePulse } from "../shared/animations";
import { OverlayProps } from "../shared/types";

export const MapCallout: React.FC<OverlayProps> = ({ scene, accentColor, delayFrames }) => {
  const { y, opacity } = useSlideFromBottom(delayFrames, 44);
  const pulse = usePulse(38);
  const locationName = scene.geoLocation?.toUpperCase() ?? "LOCATION";

  return (
    <>
      {/* Pulsing pin — placed at visual map centre */}
      <div style={{
        position:  "absolute",
        top:       "38%",
        left:      "50%",
        transform: "translate(-50%, -50%)",
      }}>
        {/* Outer slow pulse ring */}
        <div style={{
          position:     "absolute",
          top:          "50%",
          left:         "50%",
          transform:    `translate(-50%, -50%) scale(${0.65 + 0.35 * pulse})`,
          width:        64,
          height:       64,
          borderRadius: "50%",
          border:       `2px solid ${accentColor}`,
          opacity:      0.25 + 0.20 * pulse,
        }} />
        {/* Inner tighter ring */}
        <div style={{
          position:     "absolute",
          top:          "50%",
          left:         "50%",
          transform:    `translate(-50%, -50%) scale(${0.80 + 0.20 * pulse})`,
          width:        38,
          height:       38,
          borderRadius: "50%",
          border:       `1.5px solid ${accentColor}`,
          opacity:      0.45 + 0.20 * pulse,
        }} />
        {/* Solid pin dot */}
        <div style={{
          position:     "absolute",
          top:          "50%",
          left:         "50%",
          transform:    "translate(-50%, -50%)",
          width:        20,
          height:       20,
          borderRadius: "50%",
          background:   accentColor,
          boxShadow:    `0 0 22px ${accentColor}BB`,
        }} />
      </div>

      {/* Location callout label — slides up from bottom */}
      <div style={{
        position:   "absolute",
        bottom:     SAFE.BOTTOM,
        left:       SAFE.SIDE,
        right:      SAFE.SIDE,
        display:    "flex",
        alignItems: "flex-end",
        gap:        20,
        transform:  `translateY(${y}px)`,
        opacity,
      }}>
        {/* Vertical accent bar */}
        <div style={{
          width:        4,
          height:       80,
          background:   accentColor,
          borderRadius: 2,
          flexShrink:   0,
        }} />

        <div>
          <p style={{
            fontFamily:    BRAND.FONT_FAMILY,
            fontSize:      20,
            fontWeight:    BRAND.FONT_WEIGHT_MED,
            color:         accentColor,
            margin:        "0 0 8px 0",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}>LOCATION</p>
          <p style={{
            fontFamily:    BRAND.FONT_FAMILY,
            fontSize:      60,
            fontWeight:    BRAND.FONT_WEIGHT_BOLD,
            color:         BRAND.TEXT_PRIMARY,
            margin:        0,
            lineHeight:    1,
            textTransform: "uppercase",
          }}>{locationName}</p>
          {scene.overlayText && (
            <p style={{
              fontFamily: BRAND.FONT_FAMILY,
              fontSize:   32,
              fontWeight: BRAND.FONT_WEIGHT_REG,
              color:      BRAND.TEXT_SECONDARY,
              margin:     "12px 0 0 0",
              lineHeight: 1.3,
            }}>{scene.overlayText}</p>
          )}
        </div>
      </div>
    </>
  );
};

import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { useSlideFromBottom, usePulse, useFadeIn } from "../shared/animations";
import { ModuleData } from "../shared/types";

interface Props { module: ModuleData; accentColor: string }

export const MapCallout: React.FC<Props> = ({ module, accentColor }) => {
  const { y, opacity } = useSlideFromBottom(4, 44);
  const pulse          = usePulse(38);
  const mapOp          = useFadeIn(0, 18);
  const locationName   = module.locationLabel || "LOCATION";

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {/* Map image fills full frame */}
      {module.mapSrc ? (
        <Img
          src={staticFile(module.mapSrc)}
          style={{
            position:  "absolute",
            inset:     0,
            width:     "100%",
            height:    "100%",
            objectFit: "cover",
            opacity:   mapOp * 0.85,
          }}
        />
      ) : (
        /* Fallback: abstract radial */
        <AbsoluteFill style={{
          background: `radial-gradient(ellipse at center, ${accentColor}18 0%, transparent 60%)`,
        }} />
      )}

      {/* Gradient for text legibility */}
      <AbsoluteFill style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.60) 35%, rgba(0,0,0,0.10) 100%)",
      }} />

      {/* Pulsing pin */}
      <div style={{ position: "absolute", top: "38%", left: "50%", transform: "translate(-50%, -50%)" }}>
        <div style={{
          position:     "absolute", top: "50%", left: "50%",
          transform:    `translate(-50%, -50%) scale(${0.65 + 0.35 * pulse})`,
          width:        64, height: 64, borderRadius: "50%",
          border:       `2px solid ${accentColor}`,
          opacity:      0.25 + 0.20 * pulse,
        }} />
        <div style={{
          position:     "absolute", top: "50%", left: "50%",
          transform:    `translate(-50%, -50%) scale(${0.80 + 0.20 * pulse})`,
          width:        38, height: 38, borderRadius: "50%",
          border:       `1.5px solid ${accentColor}`,
          opacity:      0.45 + 0.20 * pulse,
        }} />
        <div style={{
          position:     "absolute", top: "50%", left: "50%",
          transform:    "translate(-50%, -50%)",
          width:        20, height: 20, borderRadius: "50%",
          background:   accentColor,
          boxShadow:    `0 0 22px ${accentColor}BB`,
        }} />
      </div>

      {/* Location callout */}
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
        <div style={{ width: 4, height: 80, background: accentColor, borderRadius: 2, flexShrink: 0 }} />
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
          {module.contextNote && (
            <p style={{
              fontFamily:  BRAND.FONT_FAMILY,
              fontSize:    28,
              fontWeight:  BRAND.FONT_WEIGHT_REG,
              color:       BRAND.TEXT_SECONDARY,
              margin:      "10px 0 0 0",
              lineHeight:  1.3,
            }}>{module.contextNote}</p>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

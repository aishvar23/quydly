import React from "react";
import { BRAND, SAFE } from "./brand";

export const BrandMark: React.FC<{ accentColor: string }> = ({ accentColor }) => (
  <div style={{
    position:   "absolute",
    top:        SAFE.TOP,
    right:      SAFE.SIDE,
    display:    "flex",
    alignItems: "center",
    gap:        6,
    opacity:    0.75,
  }}>
    <div style={{
      width:        4,
      height:       BRAND.MARK_FONT_SIZE,
      background:   accentColor,
      borderRadius: 2,
    }} />
    <p style={{
      fontFamily:    BRAND.FONT_FAMILY,
      fontSize:      BRAND.MARK_FONT_SIZE,
      fontWeight:    BRAND.FONT_WEIGHT_BOLD,
      color:         BRAND.TEXT_PRIMARY,
      margin:        0,
      letterSpacing: "0.12em",
    }}>{BRAND.NAME}</p>
  </div>
);

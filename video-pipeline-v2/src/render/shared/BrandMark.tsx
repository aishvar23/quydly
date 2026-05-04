import React from "react";
import { BRAND, SAFE } from "./brand";

export const BrandMark: React.FC<{ accentColor: string }> = ({ accentColor }) => (
  <div style={{
    position: "absolute",
    top: SAFE.top,
    right: SAFE.right,
    display: "flex",
    alignItems: "center",
    gap: 8,
    opacity: 0.82,
  }}>
    <div style={{
      width: 5,
      height: 29,
      borderRadius: 3,
      background: accentColor,
    }} />
    <div style={{
      color: BRAND.text,
      fontFamily: BRAND.fontFamily,
      fontSize: 28,
      fontWeight: 850,
      letterSpacing: 0,
    }}>
      {BRAND.name}
    </div>
  </div>
);

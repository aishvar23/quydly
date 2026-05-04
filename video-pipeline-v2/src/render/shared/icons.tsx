import React from "react";

export const DocIcon: React.FC<{ size?: number; color: string }> = ({ size = 22, color }) => {
  const w = size;
  const h = Math.round((size * 26) / 22);
  const sw = Math.max(1.0, size / 14.7);
  return (
    <svg width={w} height={h} viewBox="0 0 22 26" aria-hidden>
      <path d="M2 2 L13 2 L20 9 L20 24 L2 24 Z" stroke={color} strokeWidth={sw} fill="none" />
      <path d="M13 2 L13 9 L20 9" stroke={color} strokeWidth={sw} fill="none" />
      <path
        d="M5 14 L17 14 M5 18 L13 18"
        stroke={color}
        strokeWidth={sw * 0.93}
        strokeLinecap="round"
      />
    </svg>
  );
};

export const ExternalGlyph: React.FC<{ size?: number; color: string }> = ({ size = 26, color }) => {
  const sw = Math.max(1.4, size / 13);
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <path d="M9 4 L22 4 L22 17" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
      <path d="M22 4 L9 17" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
      <path d="M5 9 L5 22 L18 22" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
    </svg>
  );
};

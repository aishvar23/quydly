import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { source } from "../shared/media";
import type { RenderAsset } from "../shared/types";

export const Shell: React.FC<{
  accentColor: string;
  children: React.ReactNode;
  asset?: RenderAsset;
  imageMode?: "full" | "side" | "none";
}> = ({ accentColor, children, asset, imageMode = "none" }) => {
  const frame = useCurrentFrame();
  const slow = interpolate(frame, [0, 210], [0, -44], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill style={{ background: BRAND.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #080808 0%, #101010 48%, #050505 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.13,
          backgroundImage: [
            "linear-gradient(#ffffff 1px, transparent 1px)",
            "linear-gradient(90deg, #ffffff 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "90px 90px",
          transform: `translateY(${slow}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -120,
          top: 260,
          width: 340,
          height: 2,
          background: accentColor,
          opacity: 0.7,
          transform: "rotate(-28deg)",
        }}
      />
      {asset?.src && imageMode !== "none" ? (
        <ImageLayer asset={asset} imageMode={imageMode} />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.68) 100%)",
        }}
      />
      <div style={{ position: "absolute", inset: 0 }}>{children}</div>
    </AbsoluteFill>
  );
};

const ImageLayer: React.FC<{ asset: RenderAsset; imageMode: "full" | "side" }> = ({ asset, imageMode }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 220], [1.02, 1.08], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: imageMode === "full" ? 0 : "0 0 0 380px",
        opacity: imageMode === "full" ? 0.72 : 0.82,
        overflow: "hidden",
      }}
    >
      <Img
        src={source(asset.src || "")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
          filter: "grayscale(0.28) contrast(1.08)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: imageMode === "full"
            ? "linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.78) 100%)"
            : "linear-gradient(90deg, #0a0a0a 0%, rgba(10,10,10,0.42) 46%, rgba(10,10,10,0.04) 100%)",
        }}
      />
    </div>
  );
};

export const Panel: React.FC<{
  children: React.ReactNode;
  left?: number;
  top?: number;
  width?: number;
  padding?: number;
  accentColor?: string;
}> = ({ children, left = SAFE.left, top = 360, width = 890, padding = 40, accentColor = "#ffffff" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const appear = spring({ frame, fps, config: { damping: 22, stiffness: 120 } });

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        padding,
        borderRadius: 8,
        background: "rgba(18,18,18,0.92)",
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "0 26px 80px rgba(0,0,0,0.36)",
        transform: `translateY(${interpolate(appear, [0, 1], [34, 0])}px)`,
        opacity: appear,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          borderRadius: "8px 0 0 8px",
          background: accentColor,
        }}
      />
      {children}
    </div>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; accentColor: string }> = ({ children, accentColor }) => (
  <div
    style={{
      color: accentColor,
      fontFamily: BRAND.fontFamily,
      fontSize: 28,
      fontWeight: 850,
      letterSpacing: 0,
      textTransform: "uppercase",
      marginBottom: 20,
    }}
  >
    {children}
  </div>
);

export const BigTitle: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 76 }) => (
  <div
    style={{
      color: BRAND.text,
      fontFamily: BRAND.fontFamily,
      fontSize: size,
      fontWeight: 900,
      lineHeight: 1.02,
      letterSpacing: 0,
    }}
  >
    {children}
  </div>
);

export const BodyText: React.FC<{ children: React.ReactNode; size?: number; muted?: boolean }> = ({
  children,
  size = 34,
  muted = false,
}) => (
  <div
    style={{
      color: muted ? BRAND.muted : BRAND.text,
      fontFamily: BRAND.fontFamily,
      fontSize: size,
      lineHeight: 1.25,
      letterSpacing: 0,
      fontWeight: 650,
    }}
  >
    {children}
  </div>
);

export const Chip: React.FC<{ children: React.ReactNode; accentColor?: string }> = ({ children, accentColor }) => (
  <div
    style={{
      borderRadius: 7,
      border: `1px solid ${accentColor || "rgba(255,255,255,0.18)"}`,
      background: "rgba(255,255,255,0.07)",
      color: BRAND.text,
      fontFamily: BRAND.fontFamily,
      fontSize: 24,
      fontWeight: 750,
      padding: "12px 16px",
      letterSpacing: 0,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

export function text(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

export function list(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export function objectList(data: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = data[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null) as Array<Record<string, unknown>> : [];
}

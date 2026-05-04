import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { BRAND } from "./brand";
import { BEAT, useFadeIn } from "./motion";

export type SurfaceIntensity = "default" | "quiet";

export const ModuleSurface: React.FC<{
  accentColor: string;
  intensity?: SurfaceIntensity;
  children?: React.ReactNode;
}> = ({ accentColor, intensity = "default", children }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 220], [0, -42], { extrapolateRight: "extend" });
  const opacityRamp = useFadeIn(0, BEAT.long);
  const accentMul = intensity === "quiet" ? 0.5 : 1.0;

  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      <AbsoluteFill style={{
        background: "linear-gradient(180deg, #0A0A0A 0%, #101010 50%, #050505 100%)",
      }} />
      <AbsoluteFill style={{
        opacity: 0.10,
        backgroundImage: [
          "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "96px 96px",
        transform: `translateY(${drift}px)`,
      }} />
      <div style={{
        position: "absolute",
        left: -120, top: 220,
        width: 360, height: 2,
        background: accentColor,
        opacity: 0.55 * opacityRamp * accentMul,
        transform: "rotate(-26deg)",
      }} />
      <div style={{
        position: "absolute",
        right: -180, bottom: 380,
        width: 460, height: 2,
        background: accentColor,
        opacity: 0.36 * opacityRamp * accentMul,
        transform: "rotate(-26deg)",
      }} />
      <AbsoluteFill style={{
        background:
          "radial-gradient(ellipse at 50% 60%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 80%)",
      }} />
      {children}
    </AbsoluteFill>
  );
};

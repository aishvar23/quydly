import React from "react";
import { BRAND } from "../shared/brand";
import { ModuleSurface } from "../shared/ModuleSurface";
import { BEAT, pickText, useBreath, useFadeIn, useRiseIn } from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  bar:      0,
  mark:     BEAT.flash,
  tagline:  BEAT.short,
  breath:   30,
} as const;

export const OutroLockup: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const tagline = pickText(module.data, "line", "");
  return (
    <ModuleSurface accentColor={accentColor} intensity="quiet">
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <AccentBar accentColor={accentColor} />
        <div style={{ height: 32 }} />
        <Mark accentColor={accentColor} />
        <div style={{ height: 22 }} />
        {tagline ? <Tagline text={tagline} /> : null}
      </div>
    </ModuleSurface>
  );
};

const AccentBar: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const opacity = useFadeIn(T.bar, BEAT.short);
  return (
    <div style={{
      width: 8,
      height: 92,
      borderRadius: 4,
      background: accentColor,
      opacity,
      boxShadow: `0 0 20px ${accentColor}66`,
    }} />
  );
};

const Mark: React.FC<{ accentColor: string }> = () => {
  const { translateY, opacity } = useRiseIn(T.mark, 18, "soft");
  const breath = useBreath(T.breath, 110, 0.010);
  return (
    <div style={{
      transform: `translateY(${translateY}px) scale(${breath})`,
      opacity,
      fontFamily: FONT,
      fontSize: 110,
      fontWeight: 950,
      color: BRAND.text,
      letterSpacing: -1,
    }}>
      {BRAND.name}
    </div>
  );
};

const Tagline: React.FC<{ text: string }> = ({ text }) => {
  const opacity = useFadeIn(T.tagline, BEAT.short);
  return (
    <div style={{
      opacity,
      fontFamily: FONT,
      fontSize: 32,
      fontWeight: 700,
      color: BRAND.muted,
      letterSpacing: 0.4,
      textAlign: "center",
    }}>
      {text}
    </div>
  );
};

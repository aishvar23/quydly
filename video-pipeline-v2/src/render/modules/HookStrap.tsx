import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { ZONE } from "../shared/layout";
import { ModuleSurface } from "../shared/ModuleSurface";
import {
  Eyebrow,
  PostureChip,
  PostureChipRow,
  readPostureChips,
} from "../shared/chrome";
import {
  BEAT,
  pickText,
  useBreath,
  useDrawIn,
  useFadeIn,
  useRiseIn,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  headline:       BEAT.short,
  subhead:        BEAT.short + BEAT.long,
  accentBar:      BEAT.short + BEAT.long + BEAT.flash,
  breathStart:    100,
} as const;

export const HookStrap: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText = pickText(module.data, "kicker", "");
  const headline    = pickText(module.data, "headline", module.overlayText || "");
  const subhead     = pickText(module.data, "subhead", "");
  const postureChips = readPostureChips(module.data);

  return (
    <ModuleSurface accentColor={accentColor}>
      {postureChips.length > 0 ? (
        <PostureChipRow>
          {postureChips.map((chip, i) => (
            <PostureChip
              key={i}
              text={chip.text}
              tone={chip.tone}
              accentColor={accentColor}
              startFrame={T.postureBase + i * T.postureStagger}
            />
          ))}
        </PostureChipRow>
      ) : null}
      {eyebrowText ? (
        <Eyebrow accentColor={accentColor} startFrame={T.eyebrow}>{eyebrowText}</Eyebrow>
      ) : null}
      {headline ? <Headline text={headline} accentColor={accentColor} /> : null}
      {subhead ? <Subhead text={subhead} /> : null}
      <AccentBar accentColor={accentColor} />
    </ModuleSurface>
  );
};

const Headline: React.FC<{ text: string; accentColor: string }> = ({ text }) => {
  const { translateY, opacity } = useRiseIn(T.headline, 44, "crisp");
  const breath = useBreath(T.breathStart, 90, 0.008);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.hero + 60,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px) scale(${breath})`,
      transformOrigin: "left center",
      opacity,
      fontFamily: FONT,
      fontSize: 138,
      fontWeight: 950,
      color: BRAND.text,
      lineHeight: 0.95,
      letterSpacing: -3,
    }}>
      {text}
    </div>
  );
};

const Subhead: React.FC<{ text: string }> = ({ text }) => {
  const { translateY, opacity } = useRiseIn(T.subhead, 22, "soft");
  return (
    <div style={{
      position: "absolute",
      top: 1080,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px)`,
      opacity,
      fontFamily: FONT,
      fontSize: 38,
      fontWeight: 650,
      color: BRAND.muted,
      lineHeight: 1.28,
      letterSpacing: 0,
    }}>
      {text}
    </div>
  );
};

const AccentBar: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const draw = useDrawIn(T.accentBar, BEAT.short);
  const opacity = useFadeIn(T.accentBar, BEAT.flash);
  return (
    <div style={{
      position: "absolute",
      top: 1280,
      left: SAFE.left,
      width: 720 * draw,
      height: 6,
      borderRadius: 3,
      background: accentColor,
      opacity,
      boxShadow: `0 0 18px ${accentColor}55`,
    }} />
  );
};

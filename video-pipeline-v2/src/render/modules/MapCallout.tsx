import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { ZONE } from "../shared/layout";
import { ModuleSurface } from "../shared/ModuleSurface";
import {
  Eyebrow,
  PostureChip,
  PostureChipRow,
  SourceChip,
  readPostureChips,
} from "../shared/chrome";
import {
  BEAT,
  pickText,
  useBreath,
  useFadeIn,
  useRiseIn,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  city:           BEAT.short,
  country:        BEAT.short + BEAT.flash,
  disclaimer:     BEAT.short + BEAT.long,
  source:         BEAT.short + BEAT.long + BEAT.flash,
  breathStart:    100,
} as const;

export const MapCallout: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText    = pickText(module.data, "eyebrow",        "");
  const city           = pickText(module.data, "city",           "");
  const country        = pickText(module.data, "country",        "");
  const disclaimer     = pickText(module.data, "disclaimer",     "");
  const sourceLabel    = pickText(module.data, "sourceLabel",    "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
  // Posture chips are editorial QC chrome; off by default in viewer renders.
  const postureChips   = module.data.showPostureChips === true ? readPostureChips(module.data) : [];

  const bgSrc   = module.asset?.src || null;
  const bgKind  = module.asset?.kind;
  const isPhoto = bgKind === "place_photo";
  const hasBg   = (bgKind === "map" || isPhoto) && bgSrc;
  const photoCredit = module.asset?.credit || "";

  return (
    <ModuleSurface accentColor={accentColor} intensity={hasBg ? "quiet" : "default"}>
      {hasBg ? <BgLayer src={bgSrc!} isPhoto={isPhoto} /> : null}
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
      {city ? <CityBlock city={city} country={country} accentColor={accentColor} /> : null}
      {disclaimer ? <DisclaimerChip text={disclaimer} accentColor={accentColor} /> : null}
      {isPhoto && photoCredit ? <PhotoCredit text={photoCredit} /> : null}
      {sourceCitation ? (
        <SourceChip
          label={sourceLabel}
          citation={sourceCitation}
          startFrame={T.source}
        />
      ) : null}
    </ModuleSurface>
  );
};

const BgLayer: React.FC<{ src: string; isPhoto: boolean }> = ({ src, isPhoto }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 220], [1.04, 1.10], { extrapolateRight: "clamp" });
  const opacity = useFadeIn(0, BEAT.long);
  // Real place photos keep more saturation/brightness so the place is
  // recognisable; map tiles lean darker since they're chrome, not subject.
  const filter = isPhoto
    ? "saturate(0.85) brightness(0.62) contrast(1.05)"
    : "saturate(0.45) brightness(0.78)";
  return (
    <>
      <AbsoluteFill style={{ opacity }}>
        <Img
          src={staticFile(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
            filter,
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{
        background: isPhoto
          ? "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.30) 38%, rgba(0,0,0,0.85) 100%)"
          : "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.18) 38%, rgba(0,0,0,0.78) 100%)",
      }} />
    </>
  );
};

const PhotoCredit: React.FC<{ text: string }> = ({ text }) => {
  const opacity = useFadeIn(T.disclaimer + 4, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      bottom: 200,
      right: SAFE.right,
      opacity,
      fontFamily: FONT,
      fontSize: 16,
      fontWeight: 700,
      color: BRAND.dim,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      textShadow: "0 2px 8px rgba(0,0,0,0.7)",
    }}>
      {text}
    </div>
  );
};

const CityBlock: React.FC<{ city: string; country: string; accentColor: string }> = ({
  city,
  country,
  accentColor,
}) => {
  const cityRise = useRiseIn(T.city, 32, "crisp");
  const countryFade = useFadeIn(T.country, BEAT.short);
  const breath = useBreath(T.breathStart, 90, 0.010);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.bodyMid - 80,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${cityRise.translateY}px) scale(${breath})`,
      transformOrigin: "left center",
      opacity: cityRise.opacity,
    }}>
      <div style={{
        height: 5,
        width: 64,
        background: accentColor,
        marginBottom: 24,
        boxShadow: `0 0 14px ${accentColor}77`,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 132,
        fontWeight: 950,
        color: BRAND.text,
        lineHeight: 0.94,
        letterSpacing: -3,
        textShadow: "0 4px 18px rgba(0,0,0,0.55)",
      }}>
        {city}
      </div>
      {country ? (
        <div style={{
          marginTop: 16,
          opacity: countryFade,
          fontFamily: FONT,
          fontSize: 38,
          fontWeight: 700,
          color: BRAND.muted,
          letterSpacing: 2.4,
          textTransform: "uppercase",
          textShadow: "0 2px 12px rgba(0,0,0,0.55)",
        }}>
          {country}
        </div>
      ) : null}
    </div>
  );
};

const DisclaimerChip: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const { translateY, opacity } = useRiseIn(T.disclaimer, 14, "soft");
  return (
    <div style={{
      position: "absolute",
      top: ZONE.closing,
      left: SAFE.left,
      transform: `translateY(${translateY}px)`,
      opacity,
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      borderRadius: 6,
      background: "rgba(0,0,0,0.55)",
      border: `1px solid ${accentColor}66`,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: 4,
        background: accentColor,
        boxShadow: `0 0 10px ${accentColor}77`,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 22,
        fontWeight: 700,
        color: BRAND.text,
        letterSpacing: 0.4,
      }}>
        {text}
      </div>
    </div>
  );
};

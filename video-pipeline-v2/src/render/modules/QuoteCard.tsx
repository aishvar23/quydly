import React from "react";
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
  quoteRise:      BEAT.short,
  speakerName:    BEAT.short + BEAT.long,
  speakerRole:    BEAT.short + BEAT.long + BEAT.flash,
  source:         BEAT.short + BEAT.long + BEAT.long,
  breathStart:    100,
} as const;

export const QuoteCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText  = pickText(module.data, "eyebrow",       "");
  const quote        = pickText(module.data, "quote",         "");
  const speaker      = pickText(module.data, "speaker",       "");
  const role         = pickText(module.data, "role",          "");
  const attribution  = pickText(module.data, "attribution",   "");
  const sourceLabel  = pickText(module.data, "sourceLabel",   "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
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
      {quote ? <QuoteBlock text={quote} accentColor={accentColor} /> : null}
      {speaker || role || attribution ? (
        <SpeakerBlock speaker={speaker} role={role} attribution={attribution} accentColor={accentColor} />
      ) : null}
      {sourceCitation ? (
        <SourceChip
          label={sourceLabel}
          citation={sourceCitation}
          startFrame={T.source}
          top={ZONE.closing + 40}
        />
      ) : null}
    </ModuleSurface>
  );
};

const QuoteBlock: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const { translateY, opacity } = useRiseIn(T.quoteRise, 32, "soft");
  const breath = useBreath(T.breathStart, 90, 0.008);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.hero + 40,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px) scale(${breath})`,
      transformOrigin: "left center",
      opacity,
      display: "flex",
      gap: 24,
      alignItems: "flex-start",
    }}>
      <div style={{
        width: 6,
        alignSelf: "stretch",
        background: accentColor,
        marginTop: 14,
        marginBottom: 14,
      }} />
      <div>
        <div style={{
          height: 100,
          color: accentColor,
          fontFamily: FONT,
          fontSize: 132,
          fontWeight: 950,
          lineHeight: 1.0,
          letterSpacing: -4,
          marginBottom: 4,
          opacity: 0.72,
          overflow: "visible",
        }}>
          &ldquo;
        </div>
        <div style={{
          fontFamily: FONT,
          fontStyle: "italic",
          fontSize: 56,
          fontWeight: 700,
          color: BRAND.text,
          lineHeight: 1.2,
          letterSpacing: -0.4,
        }}>
          {text}
        </div>
      </div>
    </div>
  );
};

const SpeakerBlock: React.FC<{
  speaker: string;
  role: string;
  attribution: string;
  accentColor: string;
}> = ({ speaker, role, attribution, accentColor }) => {
  const { translateY: nameY, opacity: nameO } = useRiseIn(T.speakerName, 18, "soft");
  const roleOpacity = useFadeIn(T.speakerRole, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.bodyMid + 40,
      left: SAFE.left,
      right: SAFE.right,
    }}>
      <div style={{
        height: 4,
        width: 60,
        background: accentColor,
        opacity: nameO,
        marginBottom: 22,
      }} />
      {speaker ? (
        <div style={{
          transform: `translateY(${nameY}px)`,
          opacity: nameO,
          fontFamily: FONT,
          fontSize: 40,
          fontWeight: 900,
          color: BRAND.text,
          letterSpacing: -0.4,
        }}>
          {speaker}
        </div>
      ) : null}
      {role ? (
        <div style={{
          marginTop: 10,
          opacity: roleOpacity,
          fontFamily: FONT,
          fontSize: 26,
          fontWeight: 700,
          color: BRAND.muted,
          letterSpacing: 0.2,
        }}>
          {role}
        </div>
      ) : null}
      {attribution ? (
        <div style={{
          marginTop: 6,
          opacity: roleOpacity,
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 600,
          color: BRAND.dim,
          letterSpacing: 0.2,
        }}>
          {attribution}
        </div>
      ) : null}
    </div>
  );
};

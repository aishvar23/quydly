import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
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
import { Icon, FinanceIconKey } from "../shared/FinanceIcons";
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
  const iconKeyRaw   = pickText(module.data, "icon",          "");
  const iconKey: FinanceIconKey = (iconKeyRaw || "scales") as FinanceIconKey;
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
      <SpeakerGlyph iconKey={iconKey} accentColor={accentColor} />
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

// Decorative institution glyph centered above the quote so the verbatim
// has a visual anchor instead of floating in empty space. The icon
// gently breathes; opacity is muted so it doesn't compete with the type.
const SpeakerGlyph: React.FC<{ iconKey: FinanceIconKey; accentColor: string }> = ({
  iconKey, accentColor,
}) => {
  const opacity = useFadeIn(BEAT.flash, BEAT.long);
  const breath = useBreath(60, 130, 0.025);
  return (
    <div style={{
      position: "absolute",
      top: 220,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      opacity,
    }}>
      <div style={{
        width: 220,
        height: 220,
        transform: `scale(${breath})`,
        transformOrigin: "center center",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${accentColor}12`,
        border: `1.5px solid ${accentColor}66`,
        borderRadius: 22,
        boxShadow: `0 0 40px ${accentColor}22`,
      }}>
        <Icon iconKey={iconKey} color={accentColor} size={150} strokeWidth={2.2} />
      </div>
    </div>
  );
};

// Typewriter rendering. The spoken bridge is short (~3s) and the verbatim
// quote needs to be readable for the rest of the module duration. We
// type one character per few frames, finishing the typing well before
// the speaker block lands so the viewer reads the quote, then sees who
// said it. A blinking caret marks the active position until the typing
// completes.
const QuoteBlock: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { translateY, opacity } = useRiseIn(T.quoteRise, 32, "soft");
  const breath = useBreath(T.breathStart, 90, 0.008);

  // Reserve the first ~0.7s for the rise-in, then type for ~70% of the
  // module duration. Floor at 1.5s of typing so very short modules still
  // feel deliberate.
  const startFrame = Math.round(0.7 * fps);
  const typingFrames = Math.max(
    Math.round(1.5 * fps),
    Math.round(durationInFrames * 0.7),
  );
  const typingProgress = interpolate(
    frame,
    [startFrame, startFrame + typingFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const visibleChars = Math.floor(typingProgress * text.length);
  const visible = text.slice(0, visibleChars);
  const isTyping = visibleChars < text.length;
  const caretPhase = (frame % Math.round(fps * 0.55)) / Math.round(fps * 0.55);
  const caretOn = caretPhase < 0.55;

  // Quote drops BELOW the glyph (220 + 220 + 40 = 480) so the two stacks
  // don't fight for vertical real estate.
  return (
    <div style={{
      position: "absolute",
      top: 500,
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
          height: 80,
          color: accentColor,
          fontFamily: FONT,
          fontSize: 110,
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
          fontSize: 50,
          fontWeight: 700,
          color: BRAND.text,
          lineHeight: 1.22,
          letterSpacing: -0.4,
          minHeight: 80,
        }}>
          {visible}
          {isTyping ? (
            <span style={{
              display: "inline-block",
              width: 4,
              height: "1em",
              marginLeft: 4,
              verticalAlign: "text-bottom",
              background: caretOn ? accentColor : "transparent",
              transition: "background 50ms",
            }} />
          ) : null}
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
  // Land the speaker block AFTER the typewriter completes so the viewer
  // reads the quote, then sees who said it. Compute from module duration
  // so a 6s module shows speaker at ~4.5s and a 12s module at ~9s.
  const { fps, durationInFrames } = useVideoConfig();
  const speakerStart = Math.round(durationInFrames * 0.72);
  const roleStart = speakerStart + Math.round(fps * 0.35);
  const { translateY: nameY, opacity: nameO } = useRiseIn(speakerStart, 18, "soft");
  const roleOpacity = useFadeIn(roleStart, BEAT.short);
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

import React from "react";
import { interpolate } from "remotion";
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
  EASE,
  pickText,
  useBreath,
  useCountUp,
  useDrawIn,
  useFadeIn,
  useRiseIn,
  useStaggered,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;
const TABULAR: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const T = {
  postureBase:     2,
  postureStagger:  6,
  eyebrow:         BEAT.flash,
  stake:           BEAT.short,
  arrow:           BEAT.base + BEAT.flash,
  profitRise:      BEAT.base + BEAT.short,
  profitCount:     BEAT.base + BEAT.short + BEAT.flash,
  profitLabel:     BEAT.base + BEAT.short + BEAT.long,
  multiplierBadge: BEAT.base + BEAT.short + BEAT.long + BEAT.flash,
  wagerDots:       BEAT.base + BEAT.short + BEAT.long + BEAT.short + BEAT.flash,
  wagerLabel:      BEAT.base + BEAT.short + BEAT.long + BEAT.short + BEAT.long,
  claim:           BEAT.base + BEAT.short + BEAT.long + BEAT.short + BEAT.long + BEAT.flash,
  source:          BEAT.base + BEAT.short + BEAT.long + BEAT.short + BEAT.long + BEAT.short + BEAT.flash,
  breathStart:     100,
} as const;

export const NumberCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText    = pickText(module.data, "eyebrow",        "");
  const stakeDisplay   = pickText(module.data, "secondary",      "");
  const profitDisplay  = pickText(module.data, "primary",        "");
  const countDisplay   = pickText(module.data, "count",          "");
  const countLabel     = pickText(module.data, "label",          "");
  const stakeLabel     = pickText(module.data, "secondaryLabel", "");
  const profitLabel    = pickText(module.data, "primaryLabel",   "");
  const multiplier     = pickText(module.data, "multiplier",     "");
  const claim          = pickText(module.data, "claim",          "");
  const sourceLabel    = pickText(module.data, "sourceLabel",    "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
  // Posture chips and the wager-dot row are editorial / Quydly-quiz residue
  // from the original product surface. Off by default in news renders;
  // editors can opt back in via showPostureChips / showWagerDots for QC.
  const showPostureChips = module.data.showPostureChips === true;
  const showWagerDots    = module.data.showWagerDots === true;
  const postureChips   = showPostureChips ? readPostureChips(module.data) : [];

  const profitNumeric = parseNumber(profitDisplay);
  const profitDecimals = decimalsOf(profitDisplay);
  const countNumeric  = Math.max(0, parseNumber(countDisplay));

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
      {stakeDisplay ? <StakeBlock display={stakeDisplay} label={stakeLabel} /> : null}
      {stakeDisplay && profitDisplay ? <ArrowGlyph accentColor={accentColor} /> : null}
      {profitDisplay ? (
        <ProfitBlock
          displayPrefix={prefixOf(profitDisplay)}
          displaySuffix={suffixOf(profitDisplay)}
          target={profitNumeric}
          decimals={profitDecimals}
        />
      ) : null}
      {profitDisplay ? (
        <ProfitLabelRow label={profitLabel} multiplier={multiplier} accentColor={accentColor} />
      ) : null}
      {countNumeric > 0 ? (
        <WagerStrip
          total={countNumeric}
          display={countDisplay}
          label={countLabel}
          accentColor={accentColor}
          showDots={showWagerDots}
        />
      ) : null}
      {claim ? <ClaimStatement text={claim} accentColor={accentColor} /> : null}
      {sourceCitation ? (
        <SourceChip label={sourceLabel} citation={sourceCitation} startFrame={T.source} />
      ) : null}
    </ModuleSurface>
  );
};

const StakeBlock: React.FC<{ display: string; label: string }> = ({ display, label }) => {
  const { translateY, opacity } = useRiseIn(T.stake, 32, "soft");
  return (
    <div style={{
      position: "absolute",
      top: 350,
      left: SAFE.left,
      transform: `translateY(${translateY}px)`,
      opacity,
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 64, fontWeight: 850,
        color: BRAND.muted, lineHeight: 1.0, ...TABULAR,
      }}>
        {display}
      </div>
      {label ? (
        <div style={{
          fontFamily: FONT, fontSize: 24, fontWeight: 700,
          color: BRAND.dim, letterSpacing: 1.2, marginTop: 12,
          textTransform: "uppercase",
        }}>
          {label}
        </div>
      ) : null}
    </div>
  );
};

const ArrowGlyph: React.FC<{ accentColor: string }> = ({ accentColor }) => {
  const draw = useDrawIn(T.arrow, BEAT.short);
  const headOpacity = useFadeIn(T.arrow + BEAT.short, BEAT.flash);
  return (
    <div style={{
      position: "absolute",
      top: 510, left: SAFE.left,
      width: 320, height: 32,
      display: "flex", alignItems: "center",
    }}>
      <div style={{
        height: 4, width: 280 * draw,
        background: `linear-gradient(90deg, ${accentColor}00 0%, ${accentColor}55 35%, ${accentColor} 100%)`,
        borderRadius: 2,
      }} />
      <div style={{
        marginLeft: -1, opacity: headOpacity,
        filter: `drop-shadow(0 0 10px ${accentColor}99)`,
        display: "flex", alignItems: "center",
      }}>
        <svg width={26} height={32} viewBox="0 0 26 32" aria-hidden>
          <path d="M0 6 L0 26 L24 16 Z" fill={accentColor} />
        </svg>
      </div>
    </div>
  );
};

const ProfitBlock: React.FC<{
  displayPrefix: string;
  displaySuffix: string;
  target: number;
  decimals: number;
}> = ({ displayPrefix, displaySuffix, target, decimals }) => {
  const { translateY, opacity } = useRiseIn(T.profitRise, 44, "crisp");
  const value = useCountUp(target, T.profitCount, BEAT.long + BEAT.flash, decimals);
  const breath = useBreath(T.breathStart, 78, 0.014);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.heroStrong,
      left: SAFE.left,
      transform: `translateY(${translateY}px) scale(${breath})`,
      transformOrigin: "left center",
      opacity,
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 168, fontWeight: 950,
        color: BRAND.text, lineHeight: 0.94, letterSpacing: -3,
        ...TABULAR,
      }}>
        {displayPrefix}{formatNumber(value, decimals)}{displaySuffix}
      </div>
    </div>
  );
};

const ProfitLabelRow: React.FC<{
  label: string;
  multiplier: string;
  accentColor: string;
}> = ({ label, multiplier, accentColor }) => {
  const labelOpacity = useFadeIn(T.profitLabel, BEAT.short);
  const { translateY, opacity: badgeOpacity } = useRiseIn(T.multiplierBadge, 12, "pop");
  if (!label && !multiplier) return null;
  return (
    <div style={{
      position: "absolute",
      top: 790,
      left: SAFE.left,
      display: "flex",
      alignItems: "center",
      gap: 18,
    }}>
      {label ? (
        <div style={{
          fontFamily: FONT, fontSize: 30, fontWeight: 700,
          color: BRAND.muted, letterSpacing: 1.2, textTransform: "uppercase",
          opacity: labelOpacity,
        }}>
          {label}
        </div>
      ) : null}
      {label && multiplier ? (
        <div style={{
          fontFamily: FONT, fontSize: 22, fontWeight: 700,
          color: BRAND.dim, opacity: labelOpacity,
        }}>
          ·
        </div>
      ) : null}
      {multiplier ? (
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 5,
          border: `1px solid ${accentColor}88`,
          background: `${accentColor}0A`,
          color: accentColor,
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 850,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          transform: `translateY(${translateY}px)`,
          opacity: badgeOpacity,
        }}>
          <UpArrowIcon color={accentColor} />
          {multiplier.replace(/x/i, " ×")}
        </div>
      ) : null}
    </div>
  );
};

const UpArrowIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
    <path d="M7 1 L13 8 L9 8 L9 13 L5 13 L5 8 L1 8 Z" fill={color} />
  </svg>
);

const WagerStrip: React.FC<{
  total: number;
  display: string;
  label: string;
  accentColor: string;
  showDots: boolean;
}> = ({ total, display, label, accentColor, showDots }) => {
  const labelOpacity = useFadeIn(T.wagerLabel, BEAT.short);
  // Dot row is Quydly-quiz residue; off in news renders. The big number +
  // unit label still render — that's the news-appropriate signal.
  const dots = showDots ? Array.from({ length: total }, (_, i) => i) : [];
  return (
    <div style={{
      position: "absolute",
      top: 970,
      left: SAFE.left,
      width: 1080 - SAFE.left * 2,
    }}>
      <div style={{
        display: "flex", gap: 14, alignItems: "center",
        flexWrap: "wrap", marginBottom: 18,
      }}>
        {dots.map((i) => (
          <Dot key={i} startFrame={T.wagerDots} index={i} accentColor={accentColor} />
        ))}
        {display ? (
          <div style={{
            marginLeft: showDots ? 16 : 0,
            fontFamily: FONT, fontSize: 56, fontWeight: 950,
            color: accentColor, opacity: labelOpacity, ...TABULAR,
          }}>
            {display}
          </div>
        ) : null}
      </div>
      {label ? (
        <div style={{
          fontFamily: FONT, fontSize: 26, fontWeight: 700,
          color: BRAND.muted, letterSpacing: 1.2, opacity: labelOpacity,
          textTransform: "uppercase",
        }}>
          {label}
        </div>
      ) : null}
    </div>
  );
};

const Dot: React.FC<{ startFrame: number; index: number; accentColor: string }> = ({
  startFrame, index, accentColor,
}) => {
  const progress = useStaggered(startFrame, index, 4, BEAT.flash);
  const scale = interpolate(progress, [0, 0.6, 1], [0.4, 1.18, 1.0], { easing: EASE.punch });
  return (
    <div style={{
      width: 26, height: 26, borderRadius: 13,
      background: accentColor,
      opacity: progress,
      transform: `scale(${scale})`,
      boxShadow: `0 0 16px ${accentColor}66`,
    }} />
  );
};

const ClaimStatement: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const { translateY, opacity } = useRiseIn(T.claim, 18, "soft");
  return (
    <div style={{
      position: "absolute",
      top: ZONE.closing,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px)`,
      opacity,
      display: "flex",
      gap: 18,
      alignItems: "flex-start",
    }}>
      <div style={{
        width: 4,
        alignSelf: "stretch",
        background: accentColor,
        marginTop: 6,
        marginBottom: 6,
      }} />
      <div style={{
        fontFamily: FONT, fontSize: 34, fontWeight: 700,
        color: BRAND.text, lineHeight: 1.22, letterSpacing: 0,
      }}>
        {text}
      </div>
    </div>
  );
};

function parseNumber(display: string): number {
  const cleaned = String(display).replace(/[^\d.]/g, "");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function prefixOf(display: string): string {
  const match = String(display).match(/^[^0-9.]*/);
  return match ? match[0] : "";
}

// Trailing units like "%", " bps", "M", "B".
function suffixOf(display: string): string {
  const match = String(display).match(/[^0-9.]+$/);
  return match ? match[0] : "";
}

// Decimal places implied by the source display string. "4.25%" → 2,
// "$8 billion" → 0. Used to drive the count-up precision so we don't
// floor 4.25 to 4.
function decimalsOf(display: string): number {
  const match = String(display).match(/\.(\d+)/);
  return match ? Math.min(3, match[1].length) : 0;
}

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

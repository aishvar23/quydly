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
  useFadeIn,
  useRiseIn,
  useStaggered,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;
const TABULAR: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  title:          BEAT.short,
  chargesBase:    BEAT.short + BEAT.long,
  chargeStagger:  BEAT.flash + 2,
  authority:      BEAT.short + BEAT.long + BEAT.long,
  source:         130,
} as const;

type ChargeItem = { label: string; detail?: string };

export const ChargeCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText    = pickText(module.data, "eyebrow",        "");
  const title          = pickText(module.data, "title",          "");
  const authority      = pickText(module.data, "authority",      "");
  const sourceLabel    = pickText(module.data, "sourceLabel",    "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
  const postureChips   = readPostureChips(module.data);
  const charges        = readCharges(module.data, "charges");

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
      {title ? <BigTitle>{title}</BigTitle> : null}
      {charges.length > 0 ? (
        <ChargeList charges={charges} accentColor={accentColor} />
      ) : null}
      {authority ? <AuthorityFooter text={authority} accentColor={accentColor} /> : null}
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

const BigTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { translateY, opacity } = useRiseIn(T.title, 28, "soft");
  return (
    <div style={{
      position: "absolute",
      top: ZONE.hero,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px)`,
      opacity,
      fontFamily: FONT,
      fontSize: 92,
      fontWeight: 950,
      color: BRAND.text,
      lineHeight: 0.96,
      letterSpacing: -2,
    }}>
      {children}
    </div>
  );
};

const ChargeList: React.FC<{ charges: ChargeItem[]; accentColor: string }> = ({ charges, accentColor }) => {
  const compact = charges.length >= 5;
  return (
    <div style={{
      position: "absolute",
      top: 580,
      left: SAFE.left,
      right: SAFE.right,
      display: "flex",
      flexDirection: "column",
      gap: compact ? 14 : 20,
    }}>
      {charges.map((charge, i) => (
        <ChargeRow
          key={i}
          index={i}
          total={charges.length}
          charge={charge}
          accentColor={accentColor}
          compact={compact}
        />
      ))}
    </div>
  );
};

const ChargeRow: React.FC<{
  index: number;
  total: number;
  charge: ChargeItem;
  accentColor: string;
  compact: boolean;
}> = ({ index, total, charge, accentColor, compact }) => {
  const progress = useStaggered(T.chargesBase, index, T.chargeStagger, BEAT.short);
  const numberSize = compact ? 36 : 48;
  const labelSize = compact ? 30 : 38;
  return (
    <div style={{
      transform: `translateX(${(1 - progress) * 22}px)`,
      opacity: progress,
      display: "flex",
      gap: 22,
      alignItems: "baseline",
      padding: compact ? "14px 4px" : "18px 4px",
      borderBottom: index < total - 1 ? "1px solid rgba(255,255,255,0.08)" : "none",
    }}>
      <div style={{
        flexShrink: 0,
        fontFamily: FONT,
        fontSize: numberSize,
        fontWeight: 950,
        color: accentColor,
        letterSpacing: -1,
        minWidth: numberSize * 1.2,
        ...TABULAR,
      }}>
        {String(index + 1).padStart(2, "0")}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT,
          fontSize: labelSize,
          fontWeight: 850,
          color: BRAND.text,
          lineHeight: 1.18,
          letterSpacing: -0.3,
        }}>
          {capitalise(charge.label)}
        </div>
        {charge.detail ? (
          <div style={{
            marginTop: 6,
            fontFamily: FONT,
            fontSize: 22,
            fontWeight: 600,
            color: BRAND.muted,
            lineHeight: 1.32,
            letterSpacing: 0,
          }}>
            {charge.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const AuthorityFooter: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const opacity = useFadeIn(T.authority, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.closing + 60,
      left: SAFE.left,
      right: SAFE.right,
      opacity,
      display: "flex",
      gap: 12,
      alignItems: "center",
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        background: accentColor,
        boxShadow: `0 0 10px ${accentColor}77`,
        flexShrink: 0,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 18,
        fontWeight: 850,
        color: BRAND.dim,
        letterSpacing: 2.4,
        textTransform: "uppercase",
      }}>
        Filed by
      </div>
      <div style={{
        fontFamily: FONT,
        fontSize: 22,
        fontWeight: 700,
        color: BRAND.muted,
      }}>
        {text}
      </div>
    </div>
  );
};

function readCharges(data: Record<string, unknown>, key: string): ChargeItem[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ChargeItem | null => {
      if (typeof item === "string") {
        return item.trim() ? { label: item.trim() } : null;
      }
      if (typeof item === "object" && item !== null) {
        const label = typeof (item as Record<string, unknown>).label === "string"
          ? String((item as Record<string, unknown>).label)
          : "";
        const detail = typeof (item as Record<string, unknown>).detail === "string"
          ? String((item as Record<string, unknown>).detail)
          : undefined;
        return label.trim() ? { label: label.trim(), detail } : null;
      }
      return null;
    })
    .filter((item): item is ChargeItem => item !== null);
}

function capitalise(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

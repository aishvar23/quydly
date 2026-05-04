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
import { DocIcon, ExternalGlyph } from "../shared/icons";
import {
  BEAT,
  pickText,
  useFadeIn,
  useRiseIn,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

type SourceItem = {
  type?: string;
  title?: string;
  issuer?: string;
  date?: string;
  url?: string;
};

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  title:          BEAT.short,
  cardBase:       BEAT.short + BEAT.short,
  cardStagger:    BEAT.flash + BEAT.flash,
  meta:           BEAT.short + BEAT.short + BEAT.long,
  footer:         BEAT.short + BEAT.short + BEAT.long + BEAT.long,
} as const;

export const EvidenceShelf: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrow      = pickText(module.data, "eyebrow",      "");
  const title        = pickText(module.data, "title",        "");
  const footer       = pickText(module.data, "footer",       "");
  const sources      = readSources(module.data, "sources");
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
      {eyebrow ? (
        <Eyebrow accentColor={accentColor} startFrame={T.eyebrow}>{eyebrow}</Eyebrow>
      ) : null}
      {title ? <BigTitle>{title}</BigTitle> : null}
      {sources.length > 0 ? <CountMeta count={sources.length} accentColor={accentColor} /> : null}
      {sources.length > 0 ? <CardStack sources={sources} accentColor={accentColor} /> : null}
      {footer ? <FooterLine text={footer} accentColor={accentColor} /> : null}
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

const CountMeta: React.FC<{ count: number; accentColor: string }> = ({ count, accentColor }) => {
  const opacity = useFadeIn(T.meta, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.hero + 130,
      left: SAFE.left,
      opacity,
      fontFamily: FONT,
      fontSize: 22,
      fontWeight: 850,
      color: accentColor,
      letterSpacing: 2.6,
      textTransform: "uppercase",
    }}>
      {count} {count === 1 ? "source cited" : "sources cited"}
    </div>
  );
};

const CardStack: React.FC<{ sources: SourceItem[]; accentColor: string }> = ({ sources, accentColor }) => {
  return (
    <div style={{
      position: "absolute",
      top: 600,
      left: SAFE.left,
      right: SAFE.right,
      display: "flex",
      flexDirection: "column",
      gap: 24,
    }}>
      {sources.slice(0, 3).map((source, i) => (
        <EvidenceCard
          key={i}
          source={source}
          accentColor={accentColor}
          startFrame={T.cardBase + i * T.cardStagger}
        />
      ))}
    </div>
  );
};

const EvidenceCard: React.FC<{
  source: SourceItem;
  accentColor: string;
  startFrame: number;
}> = ({ source, accentColor, startFrame }) => {
  const { translateY, opacity } = useRiseIn(startFrame, 32, "soft");
  return (
    <div style={{
      transform: `translateY(${translateY}px)`,
      opacity,
      display: "flex",
      gap: 26,
      alignItems: "flex-start",
      padding: "30px 28px 32px",
      borderRadius: 10,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.10)",
      boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
      borderLeft: `5px solid ${accentColor}`,
    }}>
      <div style={{ flexShrink: 0, paddingTop: 6 }}>
        <DocIcon size={56} color={BRAND.muted} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {source.type ? (
          <div style={{
            fontFamily: FONT,
            fontSize: 18,
            fontWeight: 850,
            color: accentColor,
            letterSpacing: 2.2,
            textTransform: "uppercase",
            marginBottom: 10,
          }}>
            {source.type}
          </div>
        ) : null}
        {source.title ? (
          <div style={{
            fontFamily: FONT,
            fontSize: 30,
            fontWeight: 850,
            color: BRAND.text,
            lineHeight: 1.2,
            letterSpacing: -0.4,
            marginBottom: 12,
          }}>
            {source.title}
          </div>
        ) : null}
        {source.issuer || source.date ? (
          <div style={{
            fontFamily: FONT,
            fontSize: 22,
            fontWeight: 600,
            color: BRAND.muted,
            letterSpacing: 0.2,
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}>
            {source.issuer ? <span>{source.issuer}</span> : null}
            {source.issuer && source.date ? <span style={{ color: BRAND.dim }}>·</span> : null}
            {source.date ? <span style={{ color: BRAND.dim }}>{source.date}</span> : null}
          </div>
        ) : null}
      </div>
      <div style={{
        flexShrink: 0,
        alignSelf: "flex-start",
        paddingTop: 6,
        opacity: 0.85,
      }}>
        <ExternalGlyph size={32} color={accentColor} />
      </div>
    </div>
  );
};

const FooterLine: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const opacity = useFadeIn(T.footer, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.footerChip + 40,
      left: SAFE.left,
      right: SAFE.right,
      opacity,
      display: "flex",
      gap: 14,
      alignItems: "center",
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        background: accentColor,
        boxShadow: `0 0 14px ${accentColor}77`,
        flexShrink: 0,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 22,
        fontWeight: 700,
        color: BRAND.muted,
        letterSpacing: 0.2,
      }}>
        {text}
      </div>
    </div>
  );
};

function readSources(data: Record<string, unknown>, key: string): SourceItem[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      type:   typeof item.type   === "string" ? item.type   : undefined,
      title:  typeof item.title  === "string" ? item.title  : undefined,
      issuer: typeof item.issuer === "string" ? item.issuer : undefined,
      date:   typeof item.date   === "string" ? item.date   : undefined,
      url:    typeof item.url    === "string" ? item.url    : undefined,
    }));
}

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
  useFadeIn,
  useRiseIn,
  useStaggered,
} from "../shared/motion";
import { Icon, FinanceIconKey, pickIconForWho } from "../shared/FinanceIcons";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  title:          BEAT.short,
  itemsBase:      BEAT.short + BEAT.long,
  itemStagger:    BEAT.long,
  closer:         BEAT.short + BEAT.long * 4,
} as const;

type ImpactItem = { who: string; effect: string; icon?: FinanceIconKey };

export const ImpactCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText  = pickText(module.data, "eyebrow", "");
  const title        = pickText(module.data, "title",   "");
  const closer       = pickText(module.data, "closer",  "");
  const postureChips = readPostureChips(module.data);
  const items        = readItems(module.data, "items");

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
      {title ? <Title>{title}</Title> : null}
      {items.length > 0 ? <ItemList items={items} accentColor={accentColor} /> : null}
      {closer ? <Closer text={closer} accentColor={accentColor} /> : null}
    </ModuleSurface>
  );
};

const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
      fontSize: 84,
      fontWeight: 950,
      color: BRAND.text,
      lineHeight: 0.98,
      letterSpacing: -2,
    }}>
      {children}
    </div>
  );
};

// Each row: a "WHO" tag (e.g. "If you have a mortgage") above an "EFFECT"
// line (e.g. "Your monthly payment likely drops"). Staggered entry so the
// viewer reads one row at a time.
const ItemList: React.FC<{ items: ImpactItem[]; accentColor: string }> = ({ items, accentColor }) => {
  const ROW_GAP = 32;
  const ROW_HEIGHT = 188;
  return (
    <div style={{
      position: "absolute",
      top: 600,
      left: SAFE.left,
      right: SAFE.right,
      display: "flex",
      flexDirection: "column",
      gap: ROW_GAP,
    }}>
      {items.slice(0, 3).map((item, i) => (
        <ImpactRow
          key={i}
          item={item}
          index={i}
          rowHeight={ROW_HEIGHT}
          accentColor={accentColor}
        />
      ))}
    </div>
  );
};

const ImpactRow: React.FC<{
  item: ImpactItem;
  index: number;
  rowHeight: number;
  accentColor: string;
}> = ({ item, index, accentColor }) => {
  const progress = useStaggered(T.itemsBase, index, BEAT.long * 2, BEAT.short);
  const arrowOpacity = useStaggered(
    T.itemsBase + BEAT.short,
    index,
    BEAT.long * 2,
    BEAT.flash,
  );
  const iconKey: FinanceIconKey = item.icon || pickIconForWho(item.who);

  return (
    <div style={{
      transform: `translateX(${(1 - progress) * 24}px)`,
      opacity: progress,
      borderLeft: `4px solid ${accentColor}`,
      paddingLeft: 22,
      paddingTop: 14,
      paddingBottom: 14,
      display: "flex",
      gap: 24,
      alignItems: "flex-start",
    }}>
      {/* Icon column. Filled background so the icon reads against the
          dark surface, accent border to tie to the row's accent stripe. */}
      <div style={{
        width: 96,
        height: 96,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 14,
        background: `${accentColor}14`,
        border: `1.5px solid ${accentColor}55`,
        boxShadow: `0 0 18px ${accentColor}1a`,
      }}>
        <Icon iconKey={iconKey} color={accentColor} size={68} strokeWidth={2.4} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT,
          fontSize: 26,
          fontWeight: 800,
          color: accentColor,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          marginBottom: 12,
        }}>
          {item.who}
        </div>
        <div style={{
          display: "flex",
          gap: 16,
          alignItems: "baseline",
        }}>
          <div style={{
            opacity: arrowOpacity,
            color: accentColor,
            fontFamily: FONT,
            fontSize: 36,
            fontWeight: 950,
            lineHeight: 1,
            flexShrink: 0,
          }}>
            →
          </div>
          <div style={{
            fontFamily: FONT,
            fontSize: 38,
            fontWeight: 750,
            color: BRAND.text,
            lineHeight: 1.22,
            letterSpacing: -0.2,
          }}>
            {item.effect}
          </div>
        </div>
      </div>
    </div>
  );
};

const Closer: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const { translateY, opacity } = useRiseIn(T.closer, 18, "soft");
  return (
    <div style={{
      position: "absolute",
      top: ZONE.closing + 80,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px)`,
      opacity,
      display: "flex",
      gap: 16,
      alignItems: "flex-start",
    }}>
      <div style={{
        width: 4,
        alignSelf: "stretch",
        background: accentColor,
        marginTop: 8,
        marginBottom: 8,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 30,
        fontWeight: 700,
        color: BRAND.muted,
        lineHeight: 1.32,
        letterSpacing: 0,
        fontStyle: "italic",
      }}>
        {text}
      </div>
    </div>
  );
};

function readItems(data: Record<string, unknown>, key: string): ImpactItem[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ImpactItem | null => {
      if (typeof item !== "object" || item === null) return null;
      const r = item as Record<string, unknown>;
      const who = typeof r.who === "string" ? r.who.trim() : "";
      const effect = typeof r.effect === "string" ? r.effect.trim() : "";
      const iconRaw = typeof r.icon === "string" ? r.icon.trim() : "";
      if (!effect) return null;
      return {
        who,
        effect,
        icon: iconRaw ? (iconRaw as FinanceIconKey) : undefined,
      };
    })
    .filter((i): i is ImpactItem => i !== null);
}

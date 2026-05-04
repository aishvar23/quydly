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
  useBeat,
  useFadeIn,
  useRiseIn,
  useStaggered,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  title:          BEAT.short,
  lineDraw:       BEAT.short + BEAT.flash,
  eventsBase:     BEAT.short + BEAT.long,
  eventStagger:   8,
  source:         130,
} as const;

type TimelineEvent = { label: string; detail: string };

export const TimelineCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText    = pickText(module.data, "eyebrow",        "");
  const title          = pickText(module.data, "title",          "");
  const sourceLabel    = pickText(module.data, "sourceLabel",    "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
  const postureChips   = readPostureChips(module.data);
  const events         = readEvents(module.data, "events");

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
      {events.length > 0 ? <EventList events={events} accentColor={accentColor} /> : null}
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
      fontSize: 76,
      fontWeight: 950,
      color: BRAND.text,
      lineHeight: 0.96,
      letterSpacing: -2,
    }}>
      {children}
    </div>
  );
};

const EventList: React.FC<{ events: TimelineEvent[]; accentColor: string }> = ({
  events,
  accentColor,
}) => {
  const compact = events.length >= 5;
  const rowHeight = compact ? 110 : 140;
  const totalHeight = events.length * rowHeight;
  const drawProgress = useBeat(T.lineDraw, BEAT.long, EASE.out);

  return (
    <div style={{
      position: "absolute",
      top: 600,
      left: SAFE.left,
      right: SAFE.right,
      height: totalHeight,
    }}>
      {/* Vertical connector line drawing top → bottom */}
      <div style={{
        position: "absolute",
        top: 8,
        left: 12,
        width: 2,
        height: totalHeight * drawProgress - 16,
        background: `${accentColor}aa`,
        boxShadow: `0 0 6px ${accentColor}66`,
      }} />
      {events.slice(0, 5).map((event, i) => (
        <EventRow
          key={i}
          event={event}
          index={i}
          rowHeight={rowHeight}
          compact={compact}
          accentColor={accentColor}
        />
      ))}
    </div>
  );
};

const EventRow: React.FC<{
  event: TimelineEvent;
  index: number;
  rowHeight: number;
  compact: boolean;
  accentColor: string;
}> = ({ event, index, rowHeight, compact, accentColor }) => {
  const progress = useStaggered(T.eventsBase, index, T.eventStagger, BEAT.short);
  const dotScale = interpolate(progress, [0, 0.6, 1], [0.4, 1.2, 1.0], { easing: EASE.punch });
  const dotSize = compact ? 18 : 22;
  const labelSize = compact ? 26 : 30;
  const detailSize = compact ? 22 : 26;

  return (
    <div style={{
      position: "absolute",
      top: index * rowHeight,
      left: 0,
      right: 0,
      height: rowHeight,
      display: "flex",
      alignItems: "flex-start",
      gap: 32,
    }}>
      {/* Dot column */}
      <div style={{
        flexShrink: 0,
        width: 32,
        position: "relative",
        paddingTop: 4,
      }}>
        <div style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          background: accentColor,
          opacity: progress,
          transform: `scale(${dotScale}) translateX(${(12 + 1) - (dotSize / 2)}px)`,
          transformOrigin: "left center",
          boxShadow: `0 0 14px ${accentColor}88`,
        }} />
      </div>

      {/* Label + detail */}
      <div style={{
        flex: 1,
        minWidth: 0,
        opacity: progress,
        transform: `translateX(${(1 - progress) * 18}px)`,
      }}>
        <div style={{
          fontFamily: FONT,
          fontSize: labelSize,
          fontWeight: 850,
          color: accentColor,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          marginBottom: 6,
        }}>
          {event.label}
        </div>
        <div style={{
          fontFamily: FONT,
          fontSize: detailSize,
          fontWeight: 700,
          color: BRAND.text,
          lineHeight: 1.22,
          letterSpacing: 0,
        }}>
          {event.detail}
        </div>
      </div>
    </div>
  );
};

function readEvents(data: Record<string, unknown>, key: string): TimelineEvent[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item): TimelineEvent | null => {
      if (typeof item !== "object" || item === null) return null;
      const r = item as Record<string, unknown>;
      const label = typeof r.label === "string" ? r.label.trim() : "";
      const detail = typeof r.detail === "string" ? r.detail.trim() : "";
      if (!label && !detail) return null;
      return { label, detail };
    })
    .filter((e): e is TimelineEvent => e !== null);
}

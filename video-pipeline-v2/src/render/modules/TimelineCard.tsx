import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
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
} from "../shared/motion";
import { Icon, FinanceIconKey } from "../shared/FinanceIcons";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  title:          BEAT.short,
  lineDraw:       BEAT.short + BEAT.flash,
  eventsBase:     BEAT.short + BEAT.long,
  source:         130,
} as const;

type TimelineEvent = { label: string; detail: string; icon?: FinanceIconKey };

export const TimelineCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText    = pickText(module.data, "eyebrow",        "");
  const title          = pickText(module.data, "title",          "");
  const sourceLabel    = pickText(module.data, "sourceLabel",    "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
  // Posture chips are editorial QC chrome; off by default in viewer renders.
  const postureChips   = module.data.showPostureChips === true ? readPostureChips(module.data) : [];
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

// Staged reveal — each event drops, holds for ~2-3 seconds while the
// narrator describes what happened, then the next event drops. The active
// event is bright + scaled up; previous events dim down so the eye stays
// on the current beat. Total module duration is split equally across the
// events; the planner sets durationSec to (event_count * per_event_seconds).
const EventList: React.FC<{ events: TimelineEvent[]; accentColor: string }> = ({
  events,
  accentColor,
}) => {
  const { durationInFrames } = useVideoConfig();
  const visibleEvents = events.slice(0, 5);
  const rowHeight = visibleEvents.length >= 5 ? 110 : 140;
  const totalHeight = visibleEvents.length * rowHeight;

  // Reserve ~1s for the title to land before the first event, then split
  // the remaining time equally across events.
  const titleHoldFrames = 30;
  const perEventFrames = Math.max(
    45,
    Math.floor((durationInFrames - titleHoldFrames) / Math.max(1, visibleEvents.length)),
  );

  // Connector line draws progressively from the top down, in lockstep
  // with which event is currently active.
  const frame = useCurrentFrame();
  const activeIndex = Math.max(
    0,
    Math.min(
      visibleEvents.length - 1,
      Math.floor((frame - titleHoldFrames) / perEventFrames),
    ),
  );
  const lineFillProgress = Math.max(
    0,
    Math.min(
      1,
      (frame - titleHoldFrames) / (perEventFrames * Math.max(1, visibleEvents.length)),
    ),
  );

  return (
    <div style={{
      position: "absolute",
      top: 600,
      left: SAFE.left,
      right: SAFE.right,
      height: totalHeight,
    }}>
      <div style={{
        position: "absolute",
        top: 8,
        left: 12,
        width: 2,
        height: totalHeight * lineFillProgress - 16,
        background: `${accentColor}aa`,
        boxShadow: `0 0 6px ${accentColor}66`,
      }} />
      {visibleEvents.map((event, i) => (
        <EventRow
          key={i}
          event={event}
          index={i}
          startFrame={titleHoldFrames + i * perEventFrames}
          activeIndex={activeIndex}
          rowHeight={rowHeight}
          compact={visibleEvents.length >= 5}
          accentColor={accentColor}
        />
      ))}
    </div>
  );
};

const EventRow: React.FC<{
  event: TimelineEvent;
  index: number;
  startFrame: number;
  activeIndex: number;
  rowHeight: number;
  compact: boolean;
  accentColor: string;
}> = ({ event, index, startFrame, activeIndex, rowHeight, compact, accentColor }) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;

  // Fade-in over ~0.5s. After the event's window passes, dim to muted
  // text so the eye knows the story has moved on.
  const enterProgress = interpolate(local, [0, 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dotScale = interpolate(enterProgress, [0, 0.6, 1], [0.4, 1.3, 1.0], {
    easing: EASE.punch,
  });
  const isActive = index === activeIndex;
  const isPast = index < activeIndex;
  const opacityFloor = isPast ? 0.42 : 1.0;
  const dotSize = compact ? 18 : 22;
  const labelSize = compact ? 26 : 30;
  const detailSize = compact ? 22 : 26;

  // Active event gets a subtle scale boost so the row "holds" attention.
  const activeBoost = isActive ? 1.04 : 1.0;
  const textColor = isPast ? BRAND.muted : BRAND.text;
  const labelColor = isPast ? `${accentColor}88` : accentColor;

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
      transform: `scale(${activeBoost})`,
      transformOrigin: "left center",
      transition: "transform 200ms",
    }}>
      <div style={{
        flexShrink: 0,
        width: 88,
        position: "relative",
        paddingTop: 4,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}>
        <div style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          background: accentColor,
          opacity: enterProgress * opacityFloor,
          transform: `scale(${dotScale})`,
          transformOrigin: "center center",
          boxShadow: isActive
            ? `0 0 22px ${accentColor}cc`
            : `0 0 8px ${accentColor}55`,
        }} />
        {event.icon ? (
          <div style={{
            width: 64,
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: enterProgress * opacityFloor,
            background: isActive ? `${accentColor}1a` : "transparent",
            border: isActive ? `1.5px solid ${accentColor}66` : "1.5px solid transparent",
            borderRadius: 12,
            transition: "background 200ms, border-color 200ms",
          }}>
            <Icon iconKey={event.icon} color={accentColor} size={44} strokeWidth={2.2} />
          </div>
        ) : null}
      </div>

      <div style={{
        flex: 1,
        minWidth: 0,
        opacity: enterProgress * opacityFloor,
        transform: `translateX(${(1 - enterProgress) * 18}px)`,
      }}>
        <div style={{
          fontFamily: FONT,
          fontSize: labelSize,
          fontWeight: 850,
          color: labelColor,
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
          color: textColor,
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
      const icon = typeof r.icon === "string" ? (r.icon as FinanceIconKey) : undefined;
      if (!label && !detail) return null;
      return { label, detail, icon };
    })
    .filter((e): e is TimelineEvent => e !== null);
}

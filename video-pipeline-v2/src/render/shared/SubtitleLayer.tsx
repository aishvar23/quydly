import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, SAFE } from "./brand";
import type { SubtitleCue, SubtitleBlackoutRange } from "./types";

export const SubtitleLayer: React.FC<{
  subtitles: SubtitleCue[];
  blackouts?: SubtitleBlackoutRange[];
}> = ({ subtitles, blackouts }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  // Suppress the subtitle bar during modules that already render their
  // text at large type (QuoteCard, NumberCard, ChargeCard). The pipeline
  // marks those time ranges in subtitleBlackouts.
  if (blackouts && blackouts.some((b) => time >= b.startSec && time < b.endSec)) {
    return null;
  }
  const cue = subtitles.find((c) => time >= c.start && time < c.end);
  if (!cue) return null;

  return (
    <div style={{
      position: "absolute",
      left: SAFE.left + 40,
      right: SAFE.right + 40,
      bottom: 90,
      display: "flex",
      justifyContent: "center",
    }}>
      <div style={{
        background: "rgba(0,0,0,0.78)",
        borderRadius: 6,
        padding: "12px 22px",
        maxWidth: 880,
        backdropFilter: "blur(6px)",
      }}>
        <div style={{
          color: BRAND.text,
          fontFamily: BRAND.fontFamily,
          fontSize: 34,
          fontWeight: 700,
          lineHeight: 1.24,
          textAlign: "center",
          letterSpacing: 0.1,
        }}>
          {cue.text}
        </div>
      </div>
    </div>
  );
};

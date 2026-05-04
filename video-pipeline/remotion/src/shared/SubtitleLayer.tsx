import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, SAFE } from "./brand";
import { SubtitleCue } from "./types";

interface SubtitleLayerProps {
  subtitles: SubtitleCue[];
}

export const SubtitleLayer: React.FC<SubtitleLayerProps> = ({ subtitles }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const timeSec = frame / fps;
  const active  = subtitles.find(c => timeSec >= c.start && timeSec < c.end);

  if (!active) return null;

  return (
    <div style={{
      position:       "absolute",
      bottom:         SAFE.BOTTOM - 40,
      left:           SAFE.SIDE,
      right:          SAFE.SIDE,
      display:        "flex",
      justifyContent: "center",
    }}>
      <div style={{
        background:   BRAND.SUBTITLE_BG,
        padding:      "10px 20px",
        borderRadius: 4,
      }}>
        <p style={{
          fontFamily: BRAND.FONT_FAMILY,
          fontSize:   BRAND.SUBTITLE_FONT_SIZE,
          fontWeight: BRAND.FONT_WEIGHT_MED,
          color:      BRAND.TEXT_PRIMARY,
          margin:     0,
          textAlign:  "center",
          lineHeight: 1.3,
        }}>{active.text}</p>
      </div>
    </div>
  );
};

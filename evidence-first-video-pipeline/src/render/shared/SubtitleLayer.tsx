import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BRAND, SAFE } from "./brand";
import type { SubtitleCue } from "./types";

type SubtitleLayerProps = {
  subtitles: SubtitleCue[];
};

export const SubtitleLayer: React.FC<SubtitleLayerProps> = ({ subtitles }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const cue = subtitles.find((item) => time >= item.start && time < item.end);

  if (!cue) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left + 40,
        right: SAFE.right + 40,
        bottom: 72,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.58)",
          borderRadius: 5,
          padding: "9px 18px",
          maxWidth: 820,
        }}
      >
        <div
          style={{
            color: BRAND.text,
            fontFamily: BRAND.fontFamily,
            fontSize: 31,
            fontWeight: 650,
            lineHeight: 1.24,
            letterSpacing: 0,
            textAlign: "center",
          }}
        >
          {cue.text}
        </div>
      </div>
    </div>
  );
};

import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { AssetType, KenBurns } from "../shared/types";

interface BackgroundMediaProps {
  assetSrc: string | null;
  assetType: AssetType;
  kenBurns: KenBurns | null;
}

export const BackgroundMedia: React.FC<BackgroundMediaProps> = ({ assetSrc, assetType, kenBurns }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  if (!assetSrc || assetType === "motion_graphic") return null;

  const startScale = kenBurns?.start_scale ?? 1.0;
  const endScale   = kenBurns?.end_scale   ?? 1.06;
  const scale = interpolate(frame, [0, durationInFrames], [startScale, endScale], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{
        position: "absolute",
        inset: 0,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
      }}>
        {assetType === "video" ? (
          <OffthreadVideo
            src={staticFile(assetSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            muted
          />
        ) : (
          <Img
            src={staticFile(assetSrc)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND } from "./brand";
import type { RenderAsset } from "./types";

type MediaBackdropProps = {
  asset: RenderAsset;
  accentColor: string;
  intensity?: "hero" | "normal" | "quiet";
};

export const MediaBackdrop: React.FC<MediaBackdropProps> = ({
  asset,
  accentColor,
  intensity = "normal",
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, Math.max(durationInFrames, 1)], [1.02, 1.07], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, Math.max(durationInFrames, 1)], [-10, 10], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  if (asset.src) {
    const src = source(asset.src);
    return (
      <AbsoluteFill style={{ background: BRAND.bg, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateX(${drift}px) scale(${scale})`,
            transformOrigin: "center",
          }}
        >
          {asset.kind === "video" ? (
            <OffthreadVideo
              src={src}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <Img
              src={src}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
        <Shade intensity={intensity} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        background: BRAND.bg,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(145deg, ${BRAND.surface2} 0%, ${BRAND.bg} 62%, #050505 100%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.24,
          backgroundImage: [
            `linear-gradient(${accentColor} 1px, transparent 1px)`,
            `linear-gradient(90deg, ${accentColor} 1px, transparent 1px)`,
          ].join(", "),
          backgroundSize: "96px 96px",
          transform: `translateY(${interpolate(frame, [0, 180], [0, -32], {
            extrapolateRight: "extend",
          })}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.24) 42%, rgba(0,0,0,0.88) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const Shade: React.FC<{ intensity: "hero" | "normal" | "quiet" }> = ({ intensity }) => {
  const bottom = intensity === "hero" ? 0.9 : intensity === "quiet" ? 0.62 : 0.76;
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.28) 48%, rgba(0,0,0,${bottom}) 100%)`,
      }}
    />
  );
};

export function source(src: string): string {
  return /^https?:\/\//i.test(src) ? src : staticFile(src);
}

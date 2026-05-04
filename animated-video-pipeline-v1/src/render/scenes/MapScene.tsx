import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import type { RenderScene } from "../shared/types";

type MapSceneProps = {
  scene: RenderScene;
  accentColor: string;
};

export const MapScene: React.FC<MapSceneProps> = ({ scene, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pan = interpolate(frame, [0, Math.max(durationInFrames, 1)], [-20, 16], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enter = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 22, stiffness: 95, mass: 0.8 },
    durationInFrames: 22,
  });
  const labelY = interpolate(enter, [0, 1], [36, 0]);
  const pulse = 1 + Math.sin(frame / 12) * 0.06;

  return (
    <AbsoluteFill style={{ background: BRAND.bg, opacity: fade }}>
      {scene.asset.src ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateX(${pan}px) scale(1.04)`,
            transformOrigin: "center",
          }}
        >
          <Img
            src={staticFile(scene.asset.src)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      ) : (
        <MapFallback accentColor={accentColor} frame={frame} />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.86) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "42%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${pulse})`,
        }}
      >
        <div
          style={{
            width: 74,
            height: 74,
            borderRadius: 37,
            border: `3px solid ${accentColor}`,
            opacity: 0.62,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 24,
            width: 26,
            height: 26,
            borderRadius: 13,
            background: accentColor,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: SAFE.left,
          right: SAFE.right,
          bottom: SAFE.bottom,
          transform: `translateY(${labelY}px)`,
        }}
      >
        <div
          style={{
            color: accentColor,
            fontFamily: BRAND.fontFamily,
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: 0,
            marginBottom: 18,
            textTransform: "uppercase",
          }}
        >
          Map context
        </div>
        <div
          style={{
            color: BRAND.text,
            fontFamily: BRAND.fontFamily,
            fontSize: 74,
            fontWeight: 850,
            letterSpacing: 0,
            lineHeight: 1.02,
            textTransform: "uppercase",
            overflowWrap: "break-word",
          }}
        >
          {scene.geoLocation || scene.overlayText || "Global"}
        </div>
        {scene.overlayText ? (
          <div
            style={{
              color: BRAND.muted,
              fontFamily: BRAND.fontFamily,
              fontSize: 38,
              fontWeight: 650,
              marginTop: 16,
              letterSpacing: 0,
            }}
          >
            {scene.overlayText}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const MapFallback: React.FC<{ accentColor: string; frame: number }> = ({
  accentColor,
  frame,
}) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: BRAND.surface,
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: 0.32,
        backgroundImage: [
          `linear-gradient(${accentColor} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${accentColor} 1px, transparent 1px)`,
        ].join(", "),
        backgroundSize: "120px 120px",
        transform: `translate(${frame * -0.08}px, ${frame * -0.05}px)`,
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0))",
      }}
    />
  </div>
);

import React from "react";
import { BRAND, SAFE } from "./brand";
import { ZONE } from "./layout";
import { BEAT, useDrawIn, useFadeIn, useRiseIn } from "./motion";
import { DocIcon } from "./icons";

const FONT = BRAND.fontFamily;

// ─── Posture chips ───────────────────────────────────────────────────────────
// One row at ZONE.postureChip; one or more pills inside.

export type PostureSpec = { text: string; tone?: "accent" | "muted" };

export function readPostureChips(
  data: Record<string, unknown>,
  key: string = "postureChips",
): PostureSpec[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item): PostureSpec => ({
      text: typeof item.text === "string" ? item.text : "",
      tone: item.tone === "muted" ? "muted" : "accent",
    }))
    .filter((spec) => spec.text.length > 0);
}

export const PostureChipRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    position: "absolute",
    top: ZONE.postureChip,
    left: SAFE.left,
    display: "flex",
    gap: 12,
    alignItems: "center",
  }}>
    {children}
  </div>
);

export const PostureChip: React.FC<{
  text: string;
  accentColor: string;
  tone?: "accent" | "muted";
  startFrame?: number;
}> = ({ text, accentColor, tone = "accent", startFrame = 2 }) => {
  const opacity = useFadeIn(startFrame, BEAT.short);
  const isAccent = tone === "accent";
  return (
    <div style={{
      fontFamily: FONT,
      fontSize: 20,
      fontWeight: 850,
      letterSpacing: 1.6,
      padding: "8px 14px",
      borderRadius: 6,
      color: isAccent ? accentColor : "#D8D8D8",
      background: "transparent",
      border: isAccent
        ? `1.5px solid ${accentColor}`
        : "1px solid rgba(255,255,255,0.18)",
      opacity,
      textTransform: "uppercase",
    }}>
      {text}
    </div>
  );
};

// ─── Eyebrow ─────────────────────────────────────────────────────────────────

export const Eyebrow: React.FC<{
  accentColor: string;
  children: React.ReactNode;
  startFrame?: number;
}> = ({ accentColor, children, startFrame = BEAT.flash }) => {
  const drawWidth = useDrawIn(startFrame, BEAT.short);
  const fade = useFadeIn(startFrame, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top: ZONE.eyebrow,
      left: SAFE.left,
      opacity: fade,
    }}>
      <div style={{
        height: 3,
        width: 92 * drawWidth,
        background: accentColor,
        marginBottom: 14,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 28,
        fontWeight: 850,
        color: accentColor,
        letterSpacing: 4,
        textTransform: "uppercase",
      }}>
        {children}
      </div>
    </div>
  );
};

// ─── Source chip ─────────────────────────────────────────────────────────────
// "Receipt" treatment. Single source citation, doc icon, label, divider, text.

export const SourceChip: React.FC<{
  label?: string;
  citation: string;
  startFrame?: number;
  top?: number;
}> = ({ label = "Source", citation, startFrame = 130, top = ZONE.footerChip }) => {
  const { translateY, opacity } = useRiseIn(startFrame, 14, "soft");
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      transform: `translateY(${translateY}px)`,
      opacity,
      display: "inline-flex",
      alignItems: "center",
      gap: 14,
      padding: "12px 18px",
      borderRadius: 8,
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.14)",
    }}>
      <DocIcon size={22} color={BRAND.muted} />
      <div style={{
        fontFamily: FONT,
        fontSize: 16,
        fontWeight: 850,
        color: BRAND.dim,
        letterSpacing: 2.2,
        textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.12)" }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 22,
        fontWeight: 600,
        color: BRAND.muted,
        letterSpacing: 0.2,
      }}>
        {citation}
      </div>
    </div>
  );
};

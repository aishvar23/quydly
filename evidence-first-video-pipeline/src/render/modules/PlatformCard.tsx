import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Chip, Eyebrow, Panel, Shell, list, text } from "./ModuleFrame";

export const PlatformCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const frame = useCurrentFrame();
  const yes = interpolate(frame, [12, 70], [34, 86], { extrapolateRight: "clamp" });
  const chips = list(module.data, "chips");
  const marketMode = text(module.data, "displayMode", text(module.data, "side", "") ? "market" : "context") === "market";

  return (
    <Shell accentColor={accentColor}>
      <Panel top={240} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>{text(module.data, "platform", "Platform")}</Eyebrow>
        <BigTitle size={62}>{text(module.data, "market", "Market contract")}</BigTitle>
        <div style={{ height: 24 }} />
        <BodyText muted>{text(module.data, "detail", "")}</BodyText>
        <div style={{ height: 42 }} />
        {marketMode ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <MarketBox label="YES" value={yes} color="#20D6A2" />
            <MarketBox label="NO" value={100 - yes} color="#E84D5B" />
          </div>
        ) : (
          <div
            style={{
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.16)",
              padding: 24,
              background: "rgba(255,255,255,0.06)",
              color: "#FFFFFF",
              fontFamily: "'Inter', Arial, sans-serif",
              fontSize: 34,
              fontWeight: 850,
              lineHeight: 1.15,
            }}
          >
            Source-labeled platform or product context
          </div>
        )}
        <div style={{ height: 26 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Chip accentColor={accentColor}>
            {marketMode ? "Graphic reconstruction, not a platform screenshot" : "Context card, not a screenshot"}
          </Chip>
          {chips.map((chip) => <Chip key={chip}>{chip}</Chip>)}
        </div>
      </Panel>
    </Shell>
  );
};

const MarketBox: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div
    style={{
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.16)",
      padding: 22,
      background: "rgba(255,255,255,0.06)",
    }}
  >
    <div style={{ color, fontSize: 30, fontWeight: 900, fontFamily: "'Inter', Arial, sans-serif" }}>{label}</div>
    <div style={{ height: 12 }} />
    <div style={{ height: 18, background: "rgba(255,255,255,0.12)", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ width: `${value}%`, height: "100%", background: color }} />
    </div>
    <div style={{ color: "#fff", fontSize: 54, fontWeight: 900, fontFamily: "'Inter', Arial, sans-serif", marginTop: 12 }}>
      {Math.round(value)}%
    </div>
  </div>
);

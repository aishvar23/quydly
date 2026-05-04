import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Eyebrow, Panel, Shell, text } from "./ModuleFrame";

export const NumberCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 80], [0, 1], { extrapolateRight: "clamp" });
  const count = Math.round(progress * Number(text(module.data, "count", "13")));

  return (
    <Shell accentColor={accentColor}>
      <Panel top={310} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>{text(module.data, "flowLabel", "Money flow")}</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Money value={text(module.data, "secondary", "$33,034")} label={text(module.data, "secondaryLabel", "context")} />
          <div style={{ color: accentColor, fontSize: 62, fontWeight: 900 }}>-&gt;</div>
          <Money value={text(module.data, "primary", "$409,881")} label={text(module.data, "primaryLabel", "reported figure")} />
        </div>
        <div style={{ height: 58 }} />
        <BigTitle size={94}>{count}</BigTitle>
        <BodyText>{text(module.data, "label", "alleged wagers")}</BodyText>
      </Panel>
    </Shell>
  );
};

const Money: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div style={{ flex: 1 }}>
    <div style={{ color: "#fff", fontSize: 58, fontWeight: 950, fontFamily: "'Inter', Arial, sans-serif", lineHeight: 1 }}>
      {value}
    </div>
    <div style={{ color: "#B5B5B5", fontSize: 24, fontWeight: 750, fontFamily: "'Inter', Arial, sans-serif", marginTop: 10 }}>
      {label}
    </div>
  </div>
);

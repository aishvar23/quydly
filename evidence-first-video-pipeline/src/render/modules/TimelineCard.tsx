import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Eyebrow, Panel, Shell, objectList, text } from "./ModuleFrame";

export const TimelineCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const events = objectList(module.data, "events");
  const frame = useCurrentFrame();
  const line = interpolate(frame, [0, 100], [0, 1], { extrapolateRight: "clamp" });

  return (
    <Shell accentColor={accentColor}>
      <Panel top={250} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>Timeline</Eyebrow>
        <BigTitle size={62}>{text(module.data, "title", "Key developments")}</BigTitle>
        <div style={{ position: "relative", marginTop: 42, paddingLeft: 38 }}>
          <div style={{ position: "absolute", left: 11, top: 8, width: 4, height: `${line * 420}px`, background: accentColor, borderRadius: 4 }} />
          <div style={{ display: "grid", gap: 26 }}>
            {events.map((event, index) => (
              <div key={index} style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: -38, top: 8, width: 26, height: 26, borderRadius: 13, background: accentColor }} />
                <BodyText size={30}>{text(event, "label", "")}</BodyText>
                <BodyText muted size={26}>{text(event, "detail", "")}</BodyText>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </Shell>
  );
};

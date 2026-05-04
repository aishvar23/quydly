import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Eyebrow, Panel, Shell, text } from "./ModuleFrame";

export const HookStrap: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const frame = useCurrentFrame();
  const bar = interpolate(frame, [0, 28], [0, 820], { extrapolateRight: "clamp" });

  return (
    <Shell accentColor={accentColor}>
      <Panel top={520} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>{text(module.data, "kicker", "Evidence first")}</Eyebrow>
        <BigTitle size={88}>{text(module.data, "headline", module.overlayText)}</BigTitle>
        <div style={{ height: 26 }} />
        <BodyText muted>{text(module.data, "subhead", "")}</BodyText>
        <div
          style={{
            width: bar,
            height: 6,
            marginTop: 34,
            borderRadius: 6,
            background: accentColor,
          }}
        />
      </Panel>
    </Shell>
  );
};

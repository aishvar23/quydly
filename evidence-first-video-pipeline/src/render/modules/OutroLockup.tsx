import React from "react";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Shell, text } from "./ModuleFrame";

export const OutroLockup: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => (
  <Shell accentColor={accentColor}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: 8, height: 82, borderRadius: 8, background: accentColor, marginBottom: 24 }} />
      <BigTitle size={86}>QUYDLY</BigTitle>
      <div style={{ height: 18 }} />
      <BodyText muted>{text(module.data, "line", "Know the story.")}</BodyText>
    </div>
  </Shell>
);

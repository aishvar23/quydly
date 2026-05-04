import React from "react";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Chip, Eyebrow, Panel, Shell, text } from "./ModuleFrame";

export const MapCallout: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => (
  <Shell accentColor={accentColor} asset={module.asset} imageMode={module.asset?.src ? "full" : "none"}>
    <Panel top={1030} accentColor={accentColor}>
      <Eyebrow accentColor={accentColor}>Location context</Eyebrow>
      <BigTitle size={70}>{text(module.data, "location", "Location")}</BigTitle>
      <BodyText>{text(module.data, "country", "")}</BodyText>
      <div style={{ height: 24 }} />
      <Chip accentColor={accentColor}>{text(module.data, "context", "Context only")}</Chip>
    </Panel>
  </Shell>
);

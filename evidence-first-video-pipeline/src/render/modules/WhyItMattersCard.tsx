import React from "react";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Chip, Eyebrow, Panel, Shell, list, text } from "./ModuleFrame";

export const WhyItMattersCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const chips = list(module.data, "relationship");
  const fallback = ["public impact", "accountability", "what changes next"];

  return (
    <Shell accentColor={accentColor}>
      <Panel top={430} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>Why it matters</Eyebrow>
        <BigTitle size={72}>{text(module.data, "statement", "")}</BigTitle>
        <div style={{ height: 28 }} />
        <BodyText muted>{text(module.data, "support", "")}</BodyText>
        <div style={{ height: 34 }} />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {(chips.length ? chips : fallback).slice(0, 3).map((chip, index) => (
            <Chip key={chip} accentColor={index === 0 ? "#20D6A2" : index === 1 ? "#F5C451" : accentColor}>{chip}</Chip>
          ))}
        </div>
      </Panel>
    </Shell>
  );
};

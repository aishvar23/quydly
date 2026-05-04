import React from "react";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Eyebrow, Panel, Shell, list, text } from "./ModuleFrame";

export const ChargeCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const charges = list(module.data, "charges");

  return (
    <Shell accentColor={accentColor}>
      <Panel top={250} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>{text(module.data, "authority", "Charges")}</Eyebrow>
        <BigTitle size={70}>{text(module.data, "title", "Legal claims")}</BigTitle>
        <BodyText muted size={28}>{text(module.data, "posture", "allegations")}</BodyText>
        <div style={{ height: 34 }} />
        <div style={{ display: "grid", gap: 14 }}>
          {charges.map((charge, index) => (
            <div
              key={charge}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "16px 18px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.13)",
                borderRadius: 7,
              }}
            >
              <div style={{ color: accentColor, fontSize: 27, fontWeight: 900, width: 36 }}>{index + 1}</div>
              <BodyText size={28}>{charge}</BodyText>
            </div>
          ))}
        </div>
      </Panel>
    </Shell>
  );
};

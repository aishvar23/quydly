import React from "react";
import type { RenderModule } from "../shared/types";
import { BigTitle, BodyText, Chip, Eyebrow, Panel, Shell, list, text } from "./ModuleFrame";

export const DossierCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const chips = list(module.data, "chips");
  const rows = evidenceRows(module.data);
  const sourceTitle = text(module.data, "sourceTitle", "");
  const sourceMeta = text(module.data, "sourceMeta", "");

  return (
    <Shell accentColor={accentColor} asset={module.asset} imageMode={module.asset?.src ? "side" : "none"}>
      <Panel top={260} width={module.asset?.src ? 720 : 900} accentColor={accentColor}>
        <Eyebrow accentColor={accentColor}>{text(module.data, "caseLabel", "Case file")}</Eyebrow>
        <BigTitle size={60}>{text(module.data, "subject", "Subject")}</BigTitle>
        <div style={{ height: 14 }} />
        <BodyText>{text(module.data, "role", "")}</BodyText>
        <div style={{ height: 28 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {chips.map((chip) => <Chip key={chip}>{chip}</Chip>)}
        </div>
        <div style={{ height: 30 }} />
        <BodyText muted size={28}>{text(module.data, "status", "Allegations only")}</BodyText>
        <BodyText muted size={24}>{text(module.data, "note", "")}</BodyText>
        {sourceTitle ? (
          <>
            <div style={{ height: 28 }} />
            <SourceDoc title={sourceTitle} meta={sourceMeta} accentColor={accentColor} />
          </>
        ) : null}
        {rows.length ? (
          <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
            {rows.map(([label, value]) => (
              <div
                key={`${label}-${value}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "170px 1fr",
                  gap: 18,
                  alignItems: "baseline",
                  padding: "12px 14px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.055)",
                  border: "1px solid rgba(255,255,255,0.11)",
                }}
              >
                <div
                  style={{
                    color: "#B5B5B5",
                    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                    fontSize: 21,
                    fontWeight: 800,
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    color: "#FFFFFF",
                    fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
                    fontSize: 25,
                    fontWeight: 800,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
      {module.asset?.src ? (
        <div
          style={{
            position: "absolute",
            right: 64,
            bottom: 260,
            width: 520,
            color: "#fff",
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 22,
            fontWeight: 800,
            lineHeight: 1.18,
            background: "rgba(0,0,0,0.62)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 6,
            padding: "14px 18px",
          }}
        >
          CONTEXTUAL U.S. SPECIAL FORCES TRAINING IMAGE. NOT EVENT FOOTAGE.
        </div>
      ) : null}
    </Shell>
  );
};

const SourceDoc: React.FC<{ title: string; meta: string; accentColor: string }> = ({ title, meta, accentColor }) => (
  <div
    style={{
      borderRadius: 7,
      background: "rgba(255,255,255,0.075)",
      border: "1px solid rgba(255,255,255,0.16)",
      padding: "18px 20px",
      position: "relative",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 5,
        background: accentColor,
      }}
    />
    <div
      style={{
        color: accentColor,
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        fontSize: 19,
        fontWeight: 900,
        textTransform: "uppercase",
        letterSpacing: 2,
      }}
    >
      source document
    </div>
    <div
      style={{
        color: "#FFFFFF",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        fontSize: 30,
        fontWeight: 900,
        lineHeight: 1.1,
        marginTop: 8,
      }}
    >
      {title}
    </div>
    <div
      style={{
        color: "#B5B5B5",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        fontSize: 22,
        fontWeight: 700,
        marginTop: 8,
      }}
    >
      {meta}
    </div>
  </div>
);

function evidenceRows(data: Record<string, unknown>): Array<[string, string]> {
  const value = data.evidenceRows;
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (Array.isArray(row)) return [String(row[0] || ""), String(row[1] || "")] as [string, string];
    if (typeof row === "object" && row !== null) {
      const item = row as Record<string, unknown>;
      return [String(item.label || ""), String(item.value || "")] as [string, string];
    }
    return ["", String(row)] as [string, string];
  }).filter(([label, value]) => label || value);
}

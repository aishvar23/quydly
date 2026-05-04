import React from "react";
import { Img } from "remotion";
import type { RenderAssetItem, RenderModule } from "../shared/types";
import { BigTitle, BodyText, Eyebrow, Panel, Shell, text } from "./ModuleFrame";
import { source } from "../shared/media";

export const PersonCard: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const names = peopleNames(module);
  const portraitAssets = module.asset?.people?.length
    ? module.asset.people
    : module.asset?.src
      ? [{ ...module.asset, subject: text(module.data, "name", module.overlayText) }]
      : [];
  const cards = names.length
    ? names.slice(0, 2).map((name) => ({
      name,
      asset: portraitAssets.find((asset) => sameName(asset.subject, name)) || null,
    }))
    : portraitAssets.slice(0, 2).map((asset) => ({
      name: asset.subject || text(module.data, "name", module.overlayText),
      asset,
    }));
  const isPair = cards.length > 1;

  return (
    <Shell accentColor={accentColor}>
      {isPair ? (
        <div>
          {cards.map((card, index) => (
            <Portrait
              key={card.name}
              name={card.name}
              asset={card.asset}
              left={index === 0 ? 84 : 560}
              top={278}
              width={436}
              height={560}
              accentColor={accentColor}
            />
          ))}
        </div>
      ) : (
        <Portrait
          name={cards[0]?.name || text(module.data, "name", module.overlayText)}
          asset={cards[0]?.asset || portraitAssets[0] || null}
          left={84}
          top={290}
          width={440}
          height={560}
          accentColor={accentColor}
        />
      )}
      <Panel
        left={isPair ? 84 : 560}
        top={isPair ? 900 : 420}
        width={isPair ? 912 : 430}
        accentColor={accentColor}
      >
        <Eyebrow accentColor={accentColor}>{text(module.data, "label", "Person context")}</Eyebrow>
        <BigTitle size={isPair ? 50 : 56}>{text(module.data, "name", "Name")}</BigTitle>
        <div style={{ height: 18 }} />
        <BodyText>{text(module.data, "role", "")}</BodyText>
        <BodyText muted size={28}>{text(module.data, "affiliation", "")}</BodyText>
      </Panel>
    </Shell>
  );
};

const Portrait: React.FC<{
  name: string;
  asset: RenderAssetItem | null;
  left: number;
  top: number;
  width: number;
  height: number;
  accentColor: string;
}> = ({ name, asset, left, top, width, height, accentColor }) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width,
      height,
      borderRadius: 8,
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.18)",
      background: "rgba(255,255,255,0.06)",
      boxShadow: "0 30px 90px rgba(0,0,0,0.34)",
    }}
  >
    {asset?.src ? (
      <Img src={source(asset.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      <div
        style={{
          color: "#fff",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 34,
          fontFamily: "Inter, Arial, sans-serif",
          fontSize: 30,
          fontWeight: 750,
          textAlign: "center",
        }}
      >
        Image unavailable
      </div>
    )}
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "54px 24px 22px",
        color: "#fff",
        fontFamily: "Inter, Arial, sans-serif",
        fontSize: 30,
        fontWeight: 850,
        letterSpacing: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.82) 100%)",
        borderBottom: `5px solid ${accentColor}`,
      }}
    >
      {name}
    </div>
  </div>
);

function peopleNames(module: RenderModule): string[] {
  const value = module.data.people;
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function sameName(left: unknown, right: unknown): boolean {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

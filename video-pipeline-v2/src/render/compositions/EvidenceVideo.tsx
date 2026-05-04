import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { HookStrap } from "../modules/HookStrap";
import { NumberCard } from "../modules/NumberCard";
import { QuoteCard } from "../modules/QuoteCard";
import { ChargeCard } from "../modules/ChargeCard";
import { DossierCard } from "../modules/DossierCard";
import { MapCallout } from "../modules/MapCallout";
import { TimelineCard } from "../modules/TimelineCard";
import { EvidenceShelf } from "../modules/EvidenceShelf";
import { OutroLockup } from "../modules/OutroLockup";
import { BrandMark } from "../shared/BrandMark";
import { SubtitleLayer } from "../shared/SubtitleLayer";
import { BRAND } from "../shared/brand";
import type { ComponentType, RenderModule, VideoProps } from "../shared/types";

export const EvidenceVideo: React.FC<VideoProps> = ({
  modules,
  subtitles,
  audioSrc,
  musicSrc,
  accentColor,
  fps,
}) => (
  <AbsoluteFill style={{ background: BRAND.bg }}>
    {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    {/* Music bed: ducked under the narration via constant low volume. The
         human ear tolerates a 0.10–0.15 bed under speech without losing
         intelligibility. Looped+truncated to total duration by Remotion. */}
    {musicSrc ? <Audio src={staticFile(musicSrc)} volume={0.12} loop /> : null}
    {modules.map((module) => {
      const fromFrame = Math.round(module.startSec * fps);
      const durationFrames = Math.max(1, Math.round(module.durationSec * fps));
      return (
        <Sequence
          key={module.moduleId}
          from={fromFrame}
          durationInFrames={durationFrames}
          name={`Module ${module.moduleId} ${module.componentType}`}
        >
          <ModuleRouter module={module} accentColor={accentColor} />
        </Sequence>
      );
    })}
    <SubtitleLayer subtitles={subtitles} />
    <BrandMark accentColor={accentColor} />
  </AbsoluteFill>
);

const COMPONENT_REGISTRY: Partial<
  Record<ComponentType, React.FC<{ module: RenderModule; accentColor: string }>>
> = {
  HookStrap,
  NumberCard,
  QuoteCard,
  ChargeCard,
  DossierCard,
  MapCallout,
  TimelineCard,
  EvidenceShelf,
  OutroLockup,
};

const ModuleRouter: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  const Component = COMPONENT_REGISTRY[module.componentType];
  if (!Component) {
    return (
      <AbsoluteFill style={{
        background: BRAND.bg,
        color: "#777",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: BRAND.fontFamily,
        fontSize: 36,
      }}>
        [{module.componentType} not implemented]
      </AbsoluteFill>
    );
  }
  return <Component module={module} accentColor={accentColor} />;
};

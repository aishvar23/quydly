import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate } from "remotion";
import { HookStrap } from "../modules/HookStrap";
import { DossierCard } from "../modules/DossierCard";
import { PersonCard } from "../modules/PersonCard";
import { PlatformCard } from "../modules/PlatformCard";
import { NumberCard } from "../modules/NumberCard";
import { MapCallout } from "../modules/MapCallout";
import { ChargeCard } from "../modules/ChargeCard";
import { TimelineCard } from "../modules/TimelineCard";
import { WhyItMattersCard } from "../modules/WhyItMattersCard";
import { OutroLockup } from "../modules/OutroLockup";
import { BrandMark } from "../shared/BrandMark";
import { SubtitleLayer } from "../shared/SubtitleLayer";
import { source } from "../shared/media";
import { BRAND } from "../shared/brand";
import type { RenderModule, VideoProps } from "../shared/types";

export const EvidenceVideo: React.FC<VideoProps> = ({
  modules = [],
  subtitles,
  audioSrc,
  musicSrc,
  musicMix,
  accentColor,
  fps,
  totalDurationSec,
}) => {
  const totalFrames = Math.ceil(totalDurationSec * fps);
  const musicVolume = musicMix?.mixVolume ?? 0.16;

  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      {musicSrc ? (
        <Audio
          src={source(musicSrc)}
          volume={(frame) => musicBedVolume(frame, totalFrames, musicVolume)}
        />
      ) : null}
      {audioSrc ? <Audio src={source(audioSrc)} /> : null}
      {modules.map((module) => (
        <Sequence
          key={module.moduleId}
          from={Math.round(module.startSec * fps)}
          durationInFrames={Math.max(1, Math.round(module.durationSec * fps))}
          name={`Module ${module.moduleId} ${module.componentType}`}
        >
          <ModuleRouter module={module} accentColor={accentColor} />
        </Sequence>
      ))}
      <SubtitleLayer subtitles={subtitles} />
      <BrandMark accentColor={accentColor} />
    </AbsoluteFill>
  );
};

function musicBedVolume(frame: number, totalFrames: number, baseVolume: number) {
  const fadeIn = interpolate(frame, [0, 75], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [Math.max(0, totalFrames - 150), Math.max(1, totalFrames - 18)], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outroLift = interpolate(frame, [Math.max(0, totalFrames - 260), Math.max(1, totalFrames - 90)], [1, 1.28], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return baseVolume * fadeIn * fadeOut * outroLift;
}

const ModuleRouter: React.FC<{ module: RenderModule; accentColor: string }> = ({ module, accentColor }) => {
  switch (module.componentType) {
    case "HookStrap":
      return <HookStrap module={module} accentColor={accentColor} />;
    case "DossierCard":
      return <DossierCard module={module} accentColor={accentColor} />;
    case "PersonCard":
      return <PersonCard module={module} accentColor={accentColor} />;
    case "PlatformCard":
      return <PlatformCard module={module} accentColor={accentColor} />;
    case "NumberCard":
      return <NumberCard module={module} accentColor={accentColor} />;
    case "MapCallout":
      return <MapCallout module={module} accentColor={accentColor} />;
    case "ChargeCard":
      return <ChargeCard module={module} accentColor={accentColor} />;
    case "TimelineCard":
      return <TimelineCard module={module} accentColor={accentColor} />;
    case "WhyItMattersCard":
      return <WhyItMattersCard module={module} accentColor={accentColor} />;
    case "OutroLockup":
    default:
      return <OutroLockup module={module} accentColor={accentColor} />;
  }
};

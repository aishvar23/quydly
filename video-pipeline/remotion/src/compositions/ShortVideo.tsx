import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import { BRAND } from "../shared/brand";
import { ModuleData, VideoProps } from "../shared/types";
import { BrandMark } from "../shared/BrandMark";
import { SubtitleLayer } from "../shared/SubtitleLayer";
import { HookStrap } from "../modules/HookStrap";
import { PersonCard } from "../modules/PersonCard";
import { DossierCard } from "../modules/DossierCard";
import { MapCallout } from "../modules/MapCallout";
import { NumberCard } from "../modules/NumberCard";
import { ChargeCard } from "../modules/ChargeCard";
import { TimelineCard } from "../modules/TimelineCard";
import { PlatformCard } from "../modules/PlatformCard";
import { WhyItMattersCard } from "../modules/WhyItMattersCard";
import { OutroLockup } from "../modules/OutroLockup";

const ModuleRouter: React.FC<{ module: ModuleData; accentColor: string }> = ({ module, accentColor }) => {
  switch (module.moduleType) {
    case "HookStrap":        return <HookStrap        module={module} accentColor={accentColor} />;
    case "PersonCard":       return <PersonCard        module={module} accentColor={accentColor} />;
    case "DossierCard":      return <DossierCard       module={module} accentColor={accentColor} />;
    case "MapCallout":       return <MapCallout        module={module} accentColor={accentColor} />;
    case "NumberCard":       return <NumberCard        module={module} accentColor={accentColor} />;
    case "ChargeCard":       return <ChargeCard        module={module} accentColor={accentColor} />;
    case "TimelineCard":     return <TimelineCard      module={module} accentColor={accentColor} />;
    case "PlatformCard":     return <PlatformCard      module={module} accentColor={accentColor} />;
    case "WhyItMattersCard": return <WhyItMattersCard  module={module} accentColor={accentColor} />;
    case "OutroLockup":      return <OutroLockup       module={module} accentColor={accentColor} />;
    default:                 return null;
  }
};

export const ShortVideo: React.FC<VideoProps> = ({
  modules,
  subtitles,
  audioSrc,
  accentColor,
  fps,
}) => {
  const { fps: configFps } = useVideoConfig();
  const effectiveFps = fps || configFps || BRAND.FPS;

  return (
    <AbsoluteFill style={{ background: BRAND.BG }}>
      {audioSrc && <Audio src={staticFile(audioSrc)} />}

      {modules.map((mod) => {
        const fromFrame    = Math.round(mod.startSec * effectiveFps);
        const durationFrames = Math.max(1, Math.round(mod.durationSec * effectiveFps));
        return (
          <Sequence
            key={mod.moduleId}
            from={fromFrame}
            durationInFrames={durationFrames}
          >
            <ModuleRouter module={mod} accentColor={accentColor} />
          </Sequence>
        );
      })}

      <SubtitleLayer subtitles={subtitles} />
      <BrandMark accentColor={accentColor} />
    </AbsoluteFill>
  );
};

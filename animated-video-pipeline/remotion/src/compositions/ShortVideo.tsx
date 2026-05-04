import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { HookScene }    from "../scenes/HookScene";
import { ContextScene } from "../scenes/ContextScene";
import { MapScene }     from "../scenes/MapScene";
import { DataScene }    from "../scenes/DataScene";
import { ChargeScene }  from "../scenes/ChargeScene";
import { OutroScene }   from "../scenes/OutroScene";
import { SubtitleLayer } from "../shared/SubtitleLayer";
import { BrandMark }    from "../shared/BrandMark";
import { VideoProps, SceneData } from "../shared/types";

export const ShortVideo: React.FC<VideoProps> = ({
  scenes,
  subtitles,
  audioSrc,
  storyType,
  accentColor,
  fps,
}) => {
  const { fps: compFps } = useVideoConfig();
  const effectiveFps = fps || compFps;

  return (
    <AbsoluteFill style={{ background: "#0A0A0A" }}>
      {audioSrc && <Audio src={staticFile(audioSrc)} />}

      {scenes.map(scene => {
        const fromFrame = Math.round(scene.startSec * effectiveFps);
        const durFrames = Math.max(Math.round(scene.durationSec * effectiveFps), effectiveFps);

        return (
          <Sequence
            key={scene.sceneId}
            from={fromFrame}
            durationInFrames={durFrames}
            name={`Scene ${scene.sceneId} — ${scene.componentType}`}
          >
            <SceneRouter scene={scene} accentColor={accentColor} storyType={storyType} />
          </Sequence>
        );
      })}

      <SubtitleLayer subtitles={subtitles} />
      <BrandMark accentColor={accentColor} />
    </AbsoluteFill>
  );
};

interface RouterProps {
  scene: SceneData;
  accentColor: string;
  storyType: string;
}

function SceneRouter({ scene, accentColor, storyType }: RouterProps) {
  // Inject storyType into the scene so overlay components can resolve layout rules
  const enriched: SceneData = { ...scene, storyType: scene.storyType ?? storyType };

  switch (enriched.componentType) {
    case "HookScene":    return <HookScene    scene={enriched} accentColor={accentColor} />;
    case "MapScene":     return <MapScene     scene={enriched} accentColor={accentColor} />;
    case "DataScene":    return <DataScene    scene={enriched} accentColor={accentColor} />;
    case "ChargeScene":  return <ChargeScene  scene={enriched} accentColor={accentColor} />;
    case "OutroScene":   return <OutroScene   accentColor={accentColor} />;
    case "ContextScene":
    default:             return <ContextScene scene={enriched} accentColor={accentColor} />;
  }
}

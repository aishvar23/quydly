import React from "react";
import { AbsoluteFill, Audio, Sequence } from "remotion";
import { HookScene } from "../scenes/HookScene";
import { ContextScene } from "../scenes/ContextScene";
import { MapScene } from "../scenes/MapScene";
import { DataScene } from "../scenes/DataScene";
import { OutroScene } from "../scenes/OutroScene";
import { BrandMark } from "../shared/BrandMark";
import { SubtitleLayer } from "../shared/SubtitleLayer";
import { source } from "../shared/media";
import { BRAND } from "../shared/brand";
import type { RenderScene, VideoProps } from "../shared/types";

export const ShortVideo: React.FC<VideoProps> = ({
  scenes = [],
  subtitles,
  audioSrc,
  accentColor,
  fps,
}) => (
  <AbsoluteFill style={{ background: BRAND.bg }}>
    {audioSrc ? <Audio src={source(audioSrc)} /> : null}
    {scenes.map((scene) => (
      <Sequence
        key={scene.sceneId}
        from={Math.round(scene.startSec * fps)}
        durationInFrames={Math.max(1, Math.round(scene.durationSec * fps))}
        name={`Scene ${scene.sceneId}`}
      >
        <SceneRouter scene={scene} accentColor={accentColor} />
      </Sequence>
    ))}
    <SubtitleLayer subtitles={subtitles} />
    <BrandMark accentColor={accentColor} />
  </AbsoluteFill>
);

const SceneRouter: React.FC<{ scene: RenderScene; accentColor: string }> = ({
  scene,
  accentColor,
}) => {
  switch (scene.componentType) {
    case "HookScene":
      return <HookScene scene={scene} accentColor={accentColor} />;
    case "MapScene":
      return <MapScene scene={scene} accentColor={accentColor} />;
    case "DataScene":
      return <DataScene scene={scene} accentColor={accentColor} />;
    case "OutroScene":
      return <OutroScene accentColor={accentColor} />;
    case "ContextScene":
    default:
      return <ContextScene scene={scene} accentColor={accentColor} />;
  }
};

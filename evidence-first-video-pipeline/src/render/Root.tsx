import React from "react";
import { Composition, registerRoot } from "remotion";
import { EvidenceVideo } from "./compositions/EvidenceVideo";
import type { VideoProps } from "./shared/types";

const DEFAULT_PROPS: VideoProps = {
  storyType: "legal_scandal",
  accentColor: "#E84D5B",
  totalDurationSec: 48,
  fps: 30,
  audioSrc: null,
  musicSrc: null,
  musicMix: null,
  brandName: "QUYDLY",
  jobKey: "preview",
  modules: [
    {
      moduleId: 1,
      role: "hook",
      componentType: "HookStrap",
      startSec: 0,
      durationSec: 4,
      overlayText: "$409K from secret intel?",
      narration: "",
      assetClass: "graphic",
      data: {
        kicker: "FEDERAL INDICTMENT",
        headline: "$409K from secret intel?",
        subhead: "A Special Forces soldier is accused of betting on a mission he helped plan.",
      },
      asset: { kind: "graphic", src: null, safetyClass: "graphic" },
    },
    {
      moduleId: 2,
      role: "dossier",
      componentType: "DossierCard",
      startSec: 4,
      durationSec: 6,
      overlayText: "Case file: Van Dyke",
      narration: "",
      assetClass: "graphic",
      data: {
        caseLabel: "CASE FILE 155",
        subject: "Gannon Ken Van Dyke",
        role: "U.S. Army master sergeant",
        status: "Indicted; allegations only",
        chips: ["U.S. Army", "Fort Bragg", "Polymarket", "Classified access"],
      },
      asset: { kind: "graphic", src: null, safetyClass: "graphic" },
    },
  ],
  subtitles: [],
};

const RemotionRoot: React.FC = () => (
  <Composition
    id="EvidenceVideo"
    component={EvidenceVideo}
    durationInFrames={Math.ceil(DEFAULT_PROPS.totalDurationSec * DEFAULT_PROPS.fps)}
    fps={DEFAULT_PROPS.fps}
    width={1080}
    height={1920}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }: { props: VideoProps }) => ({
      durationInFrames: Math.ceil(props.totalDurationSec * props.fps),
      fps: props.fps,
      width: 1080,
      height: 1920,
    })}
  />
);

registerRoot(RemotionRoot);

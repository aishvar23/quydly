import React from "react";
import { Composition, registerRoot } from "remotion";
import { NumberCard } from "./modules/NumberCard";
import { QuoteCard } from "./modules/QuoteCard";
import { EvidenceShelf } from "./modules/EvidenceShelf";
import { EvidenceVideo } from "./compositions/EvidenceVideo";
import type { RenderModule, VideoProps } from "./shared/types";

const NUMBER_SLICE_MODULE: RenderModule = {
  moduleId: 1,
  role: "numbers",
  componentType: "NumberCard",
  startSec: 0,
  durationSec: 6,
  overlayText: "$33,034 -> $409,881",
  narration: "",
  assetClass: "graphic",
  data: {
    postureChips: [
      { text: "ALLEGED", tone: "accent" },
      { text: "INDICTMENT - ALLEGATIONS ONLY", tone: "muted" },
    ],
    eyebrow: "MONEY FLOW",
    primary: "$409,881",
    primaryLabel: "alleged profit",
    secondary: "$33,034",
    secondaryLabel: "alleged stake",
    count: "13",
    label: "alleged YES wagers",
    multiplier: "12.4x return",
    claim: "Prosecutors say 13 YES wagers turned $33,034 into $409,881.",
    sourceLabel: "Source",
    sourceCitation: "U.S. v. Van Dyke indictment, SDNY (Apr. 23, 2026)",
  },
  asset: { kind: "graphic", src: null, safetyClass: "graphic" },
};

const QUOTE_SLICE_MODULE: RenderModule = {
  moduleId: 1,
  role: "quote",
  componentType: "QuoteCard",
  startSec: 0,
  durationSec: 6,
  overlayText: "On the record",
  narration: "",
  assetClass: "graphic",
  data: {
    postureChips: [{ text: "FROM THE PRESS RELEASE", tone: "accent" }],
    eyebrow: "ON THE RECORD",
    quote: "Using classified access to bet on a covert operation crossed a clear legal line.",
    speaker: "U.S. Attorney's Office",
    role: "Southern District of New York",
    attribution: "Press release, Apr. 23, 2026",
    sourceLabel: "Source",
    sourceCitation: "DOJ press release, U.S. v. Van Dyke",
  },
  asset: { kind: "graphic", src: null, safetyClass: "graphic" },
};

const SHELF_SLICE_MODULE: RenderModule = {
  moduleId: 1,
  role: "evidence_shelf",
  componentType: "EvidenceShelf",
  startSec: 0,
  durationSec: 6,
  overlayText: "Receipts",
  narration: "",
  assetClass: "graphic",
  data: {
    postureChips: [{ text: "ATTRIBUTED EVIDENCE", tone: "accent" }],
    eyebrow: "RECEIPTS",
    title: "What we cited",
    sources: [
      {
        type: "Press release",
        title: "U.S. Soldier Charged With Using Classified Information To Profit From Prediction Market Bets",
        issuer: "U.S. Attorney's Office, SDNY",
        date: "Apr. 23, 2026",
      },
      {
        type: "Indictment",
        title: "U.S. v. Gannon Ken Van Dyke",
        issuer: "U.S. District Court, SDNY",
        date: "Unsealed Apr. 23, 2026",
      },
    ],
    footer: "Both filings are public-domain U.S. government works.",
  },
  asset: { kind: "graphic", src: null, safetyClass: "graphic" },
};

type SliceProps = { module: RenderModule; accentColor: string };

const ACCENT = "#E84D5B";

const EVIDENCE_VIDEO_DEFAULT_PROPS: VideoProps = {
  storyType: "legal_scandal",
  accentColor: ACCENT,
  totalDurationSec: 24,
  fps: 30,
  audioSrc: null,
  brandName: "QUYDLY",
  jobKey: "preview",
  modules: [NUMBER_SLICE_MODULE],
  subtitles: [],
};

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="EvidenceVideo"
      component={EvidenceVideo}
      durationInFrames={Math.ceil(EVIDENCE_VIDEO_DEFAULT_PROPS.totalDurationSec * EVIDENCE_VIDEO_DEFAULT_PROPS.fps)}
      fps={EVIDENCE_VIDEO_DEFAULT_PROPS.fps}
      width={1080}
      height={1920}
      defaultProps={EVIDENCE_VIDEO_DEFAULT_PROPS}
      calculateMetadata={({ props }: { props: VideoProps }) => ({
        durationInFrames: Math.ceil(props.totalDurationSec * props.fps),
        fps: props.fps,
        width: 1080,
        height: 1920,
      })}
    />
    <Composition
      id="NumberSlice"
      component={NumberCard}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ module: NUMBER_SLICE_MODULE, accentColor: ACCENT } satisfies SliceProps}
    />
    <Composition
      id="QuoteSlice"
      component={QuoteCard}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ module: QUOTE_SLICE_MODULE, accentColor: ACCENT } satisfies SliceProps}
    />
    <Composition
      id="EvidenceShelfSlice"
      component={EvidenceShelf}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ module: SHELF_SLICE_MODULE, accentColor: ACCENT } satisfies SliceProps}
    />
  </>
);

registerRoot(RemotionRoot);

import React from "react";
import { Composition, registerRoot } from "remotion";
import { ShortVideo } from "./compositions/ShortVideo";
import { VideoProps } from "./shared/types";
import { BRAND } from "./shared/brand";

// Story 155 — legal/scandal — default props for local preview
const DEFAULT_PROPS: VideoProps = {
  storyType:        "legal_scandal",
  accentColor:      "#DC143C",
  totalDurationSec: 55,
  fps:              BRAND.FPS,
  audioSrc:         "audio.mp3",
  brandName:        "QUYDLY",
  jobKey:           "story-155-preview",
  subtitles:        [],
  modules: [
    {
      moduleId:         0,
      moduleType:       "HookStrap",
      startSec:         0,
      endSec:           7,
      durationSec:      7,
      narrationSegment: "A federal fraud investigation just blew wide open.",
      hookText:         "FEDERAL FRAUD CASE UNSEALED",
      eyebrow:          "BREAKING",
    },
    {
      moduleId:         1,
      moduleType:       "DossierCard",
      startSec:         7,
      endSec:           16,
      durationSec:      9,
      narrationSegment: "At the center of it — Marcus Webb, a venture capital executive accused of orchestrating a decade-long scheme.",
      caseTitle:        "United States v. Webb",
      subject:          "Marcus Webb",
      chips:            ["Wire Fraud", "Securities Fraud", "Money Laundering"],
      category:         "Federal Criminal",
      dossierLocation:  "S.D.N.Y.",
    },
    {
      moduleId:         2,
      moduleType:       "NumberCard",
      startSec:         16,
      endSec:           24,
      durationSec:      8,
      narrationSegment: "Prosecutors say investors were defrauded out of two-point-three billion dollars over eleven years.",
      mainNumber:       "$2.3B",
      numberLabel:      "Alleged Fraud",
      secondaryMetric:  "11 years | 340+ investors",
    },
    {
      moduleId:         3,
      moduleType:       "MapCallout",
      startSec:         24,
      endSec:           31,
      durationSec:      7,
      narrationSegment: "The alleged scheme ran through New York, with offshore accounts traced to the Cayman Islands.",
      locationLabel:    "NEW YORK",
      mapSrc:           null,
      contextNote:      "Offshore accounts: Cayman Islands",
    },
    {
      moduleId:         4,
      moduleType:       "ChargeCard",
      startSec:         31,
      endSec:           40,
      durationSec:      9,
      narrationSegment: "Webb faces three federal counts — wire fraud, securities fraud, and money laundering — each carrying up to twenty years.",
      charges:          ["Wire Fraud — 20 yrs", "Securities Fraud — 20 yrs", "Money Laundering — 10 yrs"],
      authorityLabel:   "CHARGES FILED",
    },
    {
      moduleId:         5,
      moduleType:       "WhyItMattersCard",
      startSec:         40,
      endSec:           49,
      durationSec:      9,
      narrationSegment: "If convicted, this would be one of the largest VC fraud cases in U.S. history — and a warning signal for the entire private-equity space.",
      implicationText:  "One of the largest VC fraud cases in U.S. history.",
      supportingPhrase: "Regulators are now scrutinising 14 affiliated funds.",
    },
    {
      moduleId:         6,
      moduleType:       "OutroLockup",
      startSec:         49,
      endSec:           55,
      durationSec:      6,
      narrationSegment: "",
    },
  ],
};

const RemotionRoot: React.FC = () => (
  <Composition
    id="ShortVideo"
    component={ShortVideo}
    durationInFrames={DEFAULT_PROPS.totalDurationSec * DEFAULT_PROPS.fps}
    fps={DEFAULT_PROPS.fps}
    width={BRAND.WIDTH}
    height={BRAND.HEIGHT}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }: { props: VideoProps }) => ({
      durationInFrames: Math.ceil(props.totalDurationSec * props.fps),
      fps:              props.fps,
      width:            BRAND.WIDTH,
      height:           BRAND.HEIGHT,
    })}
  />
);

registerRoot(RemotionRoot);

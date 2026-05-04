// Evidence-first module types.
// Each ModuleType maps to a dedicated Remotion component in src/modules/.

export type ModuleType =
  | "HookStrap"
  | "PersonCard"
  | "DossierCard"
  | "MapCallout"
  | "NumberCard"
  | "ChargeCard"
  | "TimelineCard"
  | "PlatformCard"
  | "WhyItMattersCard"
  | "OutroLockup";

export interface SubtitleCue {
  start: number;
  end:   number;
  text:  string;
}

export interface ModuleData {
  moduleId:          number;
  moduleType:        ModuleType;
  startSec:          number;
  endSec:            number;
  durationSec:       number;
  narrationSegment:  string;

  // HookStrap
  hookText?: string;
  eyebrow?:  string;

  // PersonCard
  name?:        string;
  role?:        string;
  affiliation?: string;
  imageSrc?:    string | null;

  // DossierCard
  caseTitle?:       string;
  subject?:         string;
  chips?:           string[];
  category?:        string;
  dossierLocation?: string;

  // MapCallout
  locationLabel?: string;
  mapSrc?:        string | null;
  contextNote?:   string | null;

  // NumberCard
  mainNumber?:      string;
  numberLabel?:     string;
  secondaryMetric?: string | null;

  // ChargeCard
  charges?:       string[];
  authorityLabel?: string;

  // TimelineCard
  beats?: Array<{ label: string; text: string }>;

  // PlatformCard
  platformName?:        string;
  platformDescription?: string;

  // WhyItMattersCard
  implicationText?:  string;
  supportingPhrase?: string;
}

export interface VideoProps {
  storyType:        string;
  accentColor:      string;
  totalDurationSec: number;
  fps:              number;
  modules:          ModuleData[];
  subtitles:        SubtitleCue[];
  audioSrc:         string;
  brandName:        string;
  jobKey:           string;
}

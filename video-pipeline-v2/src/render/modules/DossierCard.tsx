import React from "react";
import { Img, staticFile } from "remotion";
import { BRAND, SAFE } from "../shared/brand";
import { ZONE } from "../shared/layout";
import { ModuleSurface } from "../shared/ModuleSurface";
import {
  Eyebrow,
  PostureChip,
  PostureChipRow,
  SourceChip,
  readPostureChips,
} from "../shared/chrome";
import {
  BEAT,
  pickText,
  useBreath,
  useDrawIn,
  useFadeIn,
  useRiseIn,
  useStaggered,
} from "../shared/motion";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  caseLabel:      BEAT.flash + 4,
  portrait:       BEAT.flash + 6,
  portraitCredit: BEAT.short,
  subject:        BEAT.short + 6,
  role:           BEAT.short + BEAT.long,
  affiliation:    BEAT.short + BEAT.long + BEAT.flash,
  status:         BEAT.short + BEAT.long + BEAT.short,
  chipsBase:      BEAT.short + BEAT.long + BEAT.short + BEAT.flash,
  chipStagger:    5,
  divider:        BEAT.short + BEAT.long + BEAT.short + BEAT.long,
  note:           BEAT.short + BEAT.long + BEAT.short + BEAT.long + BEAT.flash,
  source:         BEAT.short + BEAT.long + BEAT.short + BEAT.long + BEAT.short,
  breathStart:    100,
} as const;

// Layout sets — Option 1 (portrait above name, centered) when an entity
// photo is available, else the typographic-only fallback at original
// positions.
const LAYOUT_WITH_PORTRAIT = {
  caseLabelTop:  220,
  portraitTop:   270,
  portraitSize:  480,
  portraitCreditTop: 770,  // 270 + 480 + 20
  subjectTop:    830,
  subjectFont:   72,
  roleTop:       980,
  statusTop:     1080,
  chipsTop:      1200,
} as const;

const LAYOUT_TYPOGRAPHIC = {
  caseLabelTop:  360,
  portraitTop:   0,
  portraitSize:  0,
  portraitCreditTop: 0,
  subjectTop:    410,
  subjectFont:   84,
  roleTop:       600,
  statusTop:     720,
  chipsTop:      830,
} as const;

export const DossierCard: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText    = pickText(module.data, "eyebrow",        "");
  const caseLabel      = pickText(module.data, "caseLabel",      "");
  const subject        = pickText(module.data, "subject",        "");
  const role           = pickText(module.data, "role",           "");
  const affiliation    = pickText(module.data, "affiliation",    "");
  const status         = pickText(module.data, "status",         "");
  const note           = pickText(module.data, "note",           "");
  const sourceLabel    = pickText(module.data, "sourceLabel",    "Source");
  const sourceCitation = pickText(module.data, "sourceCitation", "");
  const postureChips   = readPostureChips(module.data);
  const chips          = readChipsList(module.data, "chips");

  const photoSrc = module.asset?.src || null;
  const photoKind = module.asset?.kind;
  const hasPortrait = photoKind === "entity_photo" && Boolean(photoSrc);
  const photoCredit = module.asset?.credit || "";

  const L = hasPortrait ? LAYOUT_WITH_PORTRAIT : LAYOUT_TYPOGRAPHIC;

  return (
    <ModuleSurface accentColor={accentColor}>
      {postureChips.length > 0 ? (
        <PostureChipRow>
          {postureChips.map((chip, i) => (
            <PostureChip
              key={i}
              text={chip.text}
              tone={chip.tone}
              accentColor={accentColor}
              startFrame={T.postureBase + i * T.postureStagger}
            />
          ))}
        </PostureChipRow>
      ) : null}
      {eyebrowText ? (
        <Eyebrow accentColor={accentColor} startFrame={T.eyebrow}>{eyebrowText}</Eyebrow>
      ) : null}
      {caseLabel ? <CaseLabel text={caseLabel} accentColor={accentColor} top={L.caseLabelTop} /> : null}
      {hasPortrait ? (
        <Portrait
          src={photoSrc!}
          top={L.portraitTop}
          size={L.portraitSize}
          accentColor={accentColor}
        />
      ) : null}
      {hasPortrait && photoCredit ? (
        <PortraitCredit text={photoCredit} top={L.portraitCreditTop} />
      ) : null}
      {subject ? <SubjectName text={subject} top={L.subjectTop} fontSize={L.subjectFont} /> : null}
      {role ? <RoleLine role={role} affiliation={affiliation} accentColor={accentColor} top={L.roleTop} /> : null}
      {status ? <StatusRow text={status} accentColor={accentColor} top={L.statusTop} /> : null}
      {chips.length > 0 ? <ChipRow chips={chips} accentColor={accentColor} top={L.chipsTop} /> : null}
      {note ? <ContextualNote text={note} accentColor={accentColor} /> : null}
      {sourceCitation ? (
        <SourceChip
          label={sourceLabel}
          citation={sourceCitation}
          startFrame={T.source}
        />
      ) : null}
    </ModuleSurface>
  );
};

const Portrait: React.FC<{ src: string; top: number; size: number; accentColor: string }> = ({
  src, top, size, accentColor,
}) => {
  const { translateY, opacity } = useRiseIn(T.portrait, 24, "soft");
  const breath = useBreath(T.breathStart, 90, 0.006);
  const left = (BRAND.width - size) / 2;
  return (
    <div style={{
      position: "absolute",
      top,
      left,
      width: size,
      height: size,
      transform: `translateY(${translateY}px) scale(${breath})`,
      transformOrigin: "center center",
      opacity,
      borderRadius: 12,
      overflow: "hidden",
      border: `2px solid ${accentColor}88`,
      boxShadow: `0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px ${accentColor}22 inset`,
      background: BRAND.surface,
    }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center top",
        }}
      />
      {/* subtle bottom-fade for legibility against any future overlay */}
      <div style={{
        position: "absolute",
        left: 0, right: 0, bottom: 0, height: 80,
        background: "linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.45))",
      }} />
    </div>
  );
};

const PortraitCredit: React.FC<{ text: string; top: number }> = ({ text, top }) => {
  const opacity = useFadeIn(T.portraitCredit, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top,
      left: 0,
      right: 0,
      opacity,
      textAlign: "center",
      fontFamily: FONT,
      fontSize: 18,
      fontWeight: 700,
      color: BRAND.dim,
      letterSpacing: 1.4,
      textTransform: "uppercase",
    }}>
      {text}
    </div>
  );
};

const CaseLabel: React.FC<{ text: string; accentColor: string; top: number }> = ({
  text, accentColor, top,
}) => {
  const opacity = useFadeIn(T.caseLabel, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      opacity,
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      fontFamily: FONT,
      fontSize: 18,
      fontWeight: 850,
      letterSpacing: 2.4,
      color: accentColor,
      textTransform: "uppercase",
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: 3,
        background: accentColor,
        boxShadow: `0 0 10px ${accentColor}77`,
      }} />
      {text}
    </div>
  );
};

const SubjectName: React.FC<{ text: string; top: number; fontSize: number }> = ({
  text, top, fontSize,
}) => {
  const { translateY, opacity } = useRiseIn(T.subject, 36, "crisp");
  const breath = useBreath(T.breathStart, 90, 0.008);
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px) scale(${breath})`,
      transformOrigin: "left center",
      opacity,
      fontFamily: FONT,
      fontSize,
      fontWeight: 950,
      color: BRAND.text,
      lineHeight: 0.96,
      letterSpacing: -2,
      textAlign: "center",
    }}>
      {text}
    </div>
  );
};

const RoleLine: React.FC<{ role: string; affiliation: string; accentColor: string; top: number }> = ({
  role, affiliation, accentColor, top,
}) => {
  const opacity = useFadeIn(T.role, BEAT.short);
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      right: SAFE.right,
      opacity,
      display: "flex",
      alignItems: "baseline",
      justifyContent: "center",
      gap: 16,
      flexWrap: "wrap",
    }}>
      <div style={{
        fontFamily: FONT,
        fontSize: 32,
        fontWeight: 700,
        color: BRAND.muted,
        letterSpacing: 0.2,
      }}>
        {role}
      </div>
      {affiliation ? (
        <div style={{
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 700,
          color: accentColor,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          padding: "4px 10px",
          border: `1px solid ${accentColor}88`,
          borderRadius: 4,
        }}>
          {affiliation}
        </div>
      ) : null}
    </div>
  );
};

const StatusRow: React.FC<{ text: string; accentColor: string; top: number }> = ({
  text, accentColor, top,
}) => {
  const { translateY, opacity } = useRiseIn(T.status, 16, "pop");
  return (
    <div style={{
      position: "absolute",
      top,
      left: 0,
      right: 0,
      transform: `translateY(${translateY}px)`,
      opacity,
      display: "flex",
      justifyContent: "center",
    }}>
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 18px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${accentColor}66`,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: 5,
          background: accentColor,
          boxShadow: `0 0 14px ${accentColor}99`,
        }} />
        <div style={{
          fontFamily: FONT,
          fontSize: 26,
          fontWeight: 700,
          color: BRAND.text,
          letterSpacing: 0.2,
        }}>
          {text}
        </div>
      </div>
    </div>
  );
};

const ChipRow: React.FC<{ chips: string[]; accentColor: string; top: number }> = ({
  chips, accentColor, top,
}) => {
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      right: SAFE.right,
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      justifyContent: "center",
    }}>
      {chips.slice(0, 6).map((chip, i) => (
        <Chip key={i} text={chip} index={i} accentColor={accentColor} />
      ))}
    </div>
  );
};

const Chip: React.FC<{ text: string; index: number; accentColor: string }> = ({
  text, index, accentColor,
}) => {
  const progress = useStaggered(T.chipsBase, index, T.chipStagger, BEAT.short);
  return (
    <div style={{
      transform: `translateY(${(1 - progress) * 12}px)`,
      opacity: progress,
      padding: "10px 14px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.06)",
      border: `1px solid ${accentColor}55`,
      fontFamily: FONT,
      fontSize: 22,
      fontWeight: 750,
      color: BRAND.text,
      letterSpacing: 0,
    }}>
      {text}
    </div>
  );
};

const ContextualNote: React.FC<{ text: string; accentColor: string }> = ({ text, accentColor }) => {
  const draw = useDrawIn(T.divider, BEAT.short);
  const opacity = useFadeIn(T.note, BEAT.short);
  return (
    <>
      <div style={{
        position: "absolute",
        top: ZONE.closing,
        left: SAFE.left,
        width: 280 * draw,
        height: 1,
        background: `${accentColor}66`,
      }} />
      <div style={{
        position: "absolute",
        top: ZONE.closing + 18,
        left: SAFE.left,
        right: SAFE.right,
        opacity,
        fontFamily: FONT,
        fontSize: 20,
        fontWeight: 600,
        color: BRAND.dim,
        letterSpacing: 0.4,
        fontStyle: "italic",
      }}>
        {text}
      </div>
    </>
  );
};

function readChipsList(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

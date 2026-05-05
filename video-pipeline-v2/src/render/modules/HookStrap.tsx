import React from "react";
import { BRAND, SAFE } from "../shared/brand";
import { ZONE } from "../shared/layout";
import { ModuleSurface } from "../shared/ModuleSurface";
import {
  Eyebrow,
  PostureChip,
  PostureChipRow,
  readPostureChips,
} from "../shared/chrome";
import {
  BEAT,
  pickText,
  useBreath,
  useDrawIn,
  useFadeIn,
  useRiseIn,
} from "../shared/motion";
import { Icon, FinanceIconKey } from "../shared/FinanceIcons";
import type { RenderModule } from "../shared/types";

const FONT = BRAND.fontFamily;

const T = {
  postureBase:    2,
  postureStagger: 6,
  eyebrow:        BEAT.flash,
  headline:       BEAT.short,
  subhead:        BEAT.short + BEAT.long,
  accentBar:      BEAT.short + BEAT.long + BEAT.flash,
  breathStart:    100,
} as const;

export const HookStrap: React.FC<{ module: RenderModule; accentColor: string }> = ({
  module,
  accentColor,
}) => {
  const eyebrowText = pickText(module.data, "kicker", "");
  const headline    = pickText(module.data, "headline", module.overlayText || "");
  const subhead     = pickText(module.data, "subhead", "");
  const postureChips = readPostureChips(module.data);

  // Optional icon flow: data.iconFlow is an array of FinanceIconKey
  // (e.g. ["bank", "down", "house"]) that renders ABOVE the headline as
  // a visual metaphor for the story (bank lowers rates -> homebuyer wins).
  // Story types that don't supply iconFlow get the typographic-only hook.
  const iconFlow = readIconFlow(module.data);

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
      {iconFlow.length > 0 ? <IconFlowRow icons={iconFlow} accentColor={accentColor} /> : null}
      {headline ? <Headline text={headline} accentColor={accentColor} hasIcons={iconFlow.length > 0} /> : null}
      {subhead ? <Subhead text={subhead} hasIcons={iconFlow.length > 0} /> : null}
      <AccentBar accentColor={accentColor} hasIcons={iconFlow.length > 0} />
    </ModuleSurface>
  );
};

const ICON_FLOW_TOP = 380;
const ICON_FLOW_SIZE = 168;

const IconFlowRow: React.FC<{ icons: FinanceIconKey[]; accentColor: string }> = ({
  icons, accentColor,
}) => {
  // 3-icon flow renders centered with a gentle stagger and breathing
  // scale so the row feels alive instead of pasted on. Connector lines
  // draw between icons in accent color so the eye understands the flow.
  return (
    <div style={{
      position: "absolute",
      top: ICON_FLOW_TOP,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: 28,
    }}>
      {icons.slice(0, 3).map((iconKey, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Connector accentColor={accentColor} index={i - 1} /> : null}
          <IconSlot iconKey={iconKey} index={i} accentColor={accentColor} />
        </React.Fragment>
      ))}
    </div>
  );
};

const IconSlot: React.FC<{ iconKey: FinanceIconKey; index: number; accentColor: string }> = ({
  iconKey, index, accentColor,
}) => {
  const { translateY, opacity } = useRiseIn(BEAT.short + index * BEAT.long, 24, "soft");
  const breath = useBreath(80, 110, 0.018);
  return (
    <div style={{
      width: ICON_FLOW_SIZE,
      height: ICON_FLOW_SIZE,
      transform: `translateY(${translateY}px) scale(${breath})`,
      opacity,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: `${accentColor}10`,
      border: `1.5px solid ${accentColor}55`,
      borderRadius: 16,
      boxShadow: `0 0 24px ${accentColor}22`,
    }}>
      <Icon iconKey={iconKey} color={accentColor} size={108} strokeWidth={2.4} />
    </div>
  );
};

const Connector: React.FC<{ accentColor: string; index: number }> = ({ accentColor, index }) => {
  const draw = useDrawIn(BEAT.short + BEAT.long * (index + 1), BEAT.short);
  return (
    <div style={{
      width: 56 * draw,
      height: 4,
      background: `linear-gradient(90deg, ${accentColor}33 0%, ${accentColor} 100%)`,
      borderRadius: 2,
      boxShadow: `0 0 10px ${accentColor}55`,
    }} />
  );
};

function readIconFlow(data: Record<string, unknown>): FinanceIconKey[] {
  const value = (data as Record<string, unknown>).iconFlow;
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .filter((s): s is FinanceIconKey => /^[a-zA-Z]+$/.test(s)) as FinanceIconKey[];
}

const Headline: React.FC<{ text: string; accentColor: string; hasIcons?: boolean }> = ({
  text, hasIcons,
}) => {
  const { translateY, opacity } = useRiseIn(T.headline, 44, "crisp");
  const breath = useBreath(T.breathStart, 90, 0.008);
  // When the icon flow is present, the headline drops below it. Smaller
  // type so the row + headline + subhead fit inside the safe area.
  const top = hasIcons ? ICON_FLOW_TOP + ICON_FLOW_SIZE + 80 : ZONE.hero + 60;
  const fontSize = hasIcons ? 96 : 138;
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
      lineHeight: 0.95,
      letterSpacing: -3,
    }}>
      {text}
    </div>
  );
};

const Subhead: React.FC<{ text: string; hasIcons?: boolean }> = ({ text, hasIcons }) => {
  const { translateY, opacity } = useRiseIn(T.subhead, 22, "soft");
  const top = hasIcons ? ICON_FLOW_TOP + ICON_FLOW_SIZE + 80 + 230 : 1080;
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      right: SAFE.right,
      transform: `translateY(${translateY}px)`,
      opacity,
      fontFamily: FONT,
      fontSize: 48,
      fontWeight: 750,
      color: BRAND.text,
      lineHeight: 1.24,
      letterSpacing: -0.2,
    }}>
      {text}
    </div>
  );
};

const AccentBar: React.FC<{ accentColor: string; hasIcons?: boolean }> = ({
  accentColor, hasIcons,
}) => {
  const draw = useDrawIn(T.accentBar, BEAT.short);
  const opacity = useFadeIn(T.accentBar, BEAT.flash);
  const top = hasIcons ? ICON_FLOW_TOP + ICON_FLOW_SIZE + 80 + 230 + 180 : 1280;
  return (
    <div style={{
      position: "absolute",
      top,
      left: SAFE.left,
      width: 720 * draw,
      height: 6,
      borderRadius: 3,
      background: accentColor,
      opacity,
      boxShadow: `0 0 18px ${accentColor}55`,
    }} />
  );
};

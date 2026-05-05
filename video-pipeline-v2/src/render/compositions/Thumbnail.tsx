import React from "react";
import { AbsoluteFill } from "remotion";
import { BRAND } from "../shared/brand";
import { Icon, FinanceIconKey } from "../shared/FinanceIcons";

// YouTube-spec thumbnail. 1280x720. Single still frame. Lane-driven via
// `thumbnail` props so the same composition serves every story type.
//
// Design priorities, ranked:
//   1. Single focal number/figure that reads at smallest preview size
//   2. Arrow / down-icon to signal direction (rate cut, drop, etc.)
//   3. 3-icon "personal impact" column on the right (mortgage / savings /
//      debt) so the viewer recognises themselves in 1 second
//   4. Top headline ≤ 4 words, ALL CAPS — emotional hook
//   5. Bottom: brand mark + accent bar
//
// Mobile YouTube preview is ~270x150, so any element under ~28pt at the
// thumbnail's native size will be illegible. We design at 1280x720 with
// the smallest type at 36pt, biggest at 220pt.

export type ThumbnailImpactSlot = {
  icon: FinanceIconKey;
  label: string;
};

export type ThumbnailProps = {
  accentColor: string;
  topText: string;             // "FED CUTS RATES" — top hook
  bigNumber: string;           // "4.25%" or "−$8B" — center hero
  bigNumberLabel?: string;     // "NEW RATE CEILING"
  changeBadge?: string;        // "↓ 0.25" — tiny decorator on the number
  mainIcon?: FinanceIconKey;   // optional iconography next to the number
  impactSlots?: ThumbnailImpactSlot[]; // up to 3 right-column impacts
  bottomText?: string;         // "WHAT IT MEANS FOR YOU"
  brandName: string;
  publishedDate?: string | null;
};

const FONT = BRAND.fontFamily;

export const Thumbnail: React.FC<ThumbnailProps> = ({
  accentColor,
  topText,
  bigNumber,
  bigNumberLabel,
  changeBadge,
  mainIcon = "down",
  impactSlots = [],
  bottomText = "WHAT IT MEANS FOR YOU",
  brandName,
  publishedDate,
}) => {
  return (
    <AbsoluteFill style={{ background: BRAND.bg }}>
      {/* Layered background: gradient + grid + accent radials */}
      <AbsoluteFill style={{
        background: "linear-gradient(135deg, #0A0A0A 0%, #141414 50%, #050505 100%)",
      }} />
      <AbsoluteFill style={{
        opacity: 0.08,
        backgroundImage: [
          "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)",
          "linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
        ].join(", "),
        backgroundSize: "64px 64px",
      }} />
      <AbsoluteFill style={{
        background: `radial-gradient(circle at 28% 50%, ${accentColor}1f 0%, transparent 60%)`,
      }} />

      {/* Top headline strip — bold accent stripe + ALL CAPS hook */}
      <TopStrip accentColor={accentColor} text={topText} />

      {/* Center hero: arrow icon + big number */}
      <HeroBlock
        accentColor={accentColor}
        bigNumber={bigNumber}
        bigNumberLabel={bigNumberLabel}
        changeBadge={changeBadge}
        mainIcon={mainIcon}
      />

      {/* Right column: 3 personal-impact icons */}
      {impactSlots.length > 0 ? (
        <ImpactColumn slots={impactSlots} accentColor={accentColor} />
      ) : null}

      {/* Bottom strip: bottom text + brand mark + published date */}
      <BottomStrip
        accentColor={accentColor}
        text={bottomText}
        brandName={brandName}
        publishedDate={publishedDate}
      />
    </AbsoluteFill>
  );
};

const TopStrip: React.FC<{ accentColor: string; text: string }> = ({
  accentColor, text,
}) => (
  <div style={{
    position: "absolute",
    top: 56,
    left: 64,
    display: "flex",
    alignItems: "center",
    gap: 18,
  }}>
    <div style={{
      width: 80,
      height: 8,
      background: accentColor,
      borderRadius: 4,
      boxShadow: `0 0 18px ${accentColor}88`,
    }} />
    <div style={{
      fontFamily: FONT,
      fontSize: 56,
      fontWeight: 950,
      color: BRAND.text,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      lineHeight: 1,
    }}>
      {text}
    </div>
  </div>
);

const HeroBlock: React.FC<{
  accentColor: string;
  bigNumber: string;
  bigNumberLabel?: string;
  changeBadge?: string;
  mainIcon: FinanceIconKey;
}> = ({ accentColor, bigNumber, bigNumberLabel, changeBadge, mainIcon }) => (
  <div style={{
    position: "absolute",
    top: 168,
    left: 64,
    width: 720,
    height: 420,
    display: "flex",
    alignItems: "center",
    gap: 28,
  }}>
    {/* Arrow / direction icon panel */}
    <div style={{
      width: 200,
      height: 280,
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: `${accentColor}14`,
      border: `2px solid ${accentColor}`,
      borderRadius: 18,
      boxShadow: `0 0 36px ${accentColor}33`,
    }}>
      <Icon iconKey={mainIcon} color={accentColor} size={160} strokeWidth={3.2} />
    </div>

    {/* Number stack */}
    <div style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      flex: 1,
    }}>
      <div style={{
        fontFamily: FONT,
        fontSize: 220,
        fontWeight: 950,
        color: BRAND.text,
        lineHeight: 0.9,
        letterSpacing: -8,
        fontVariantNumeric: "tabular-nums",
      }}>
        {bigNumber}
      </div>
      {bigNumberLabel ? (
        <div style={{
          marginTop: 14,
          fontFamily: FONT,
          fontSize: 32,
          fontWeight: 800,
          color: accentColor,
          letterSpacing: 2.4,
          textTransform: "uppercase",
        }}>
          {bigNumberLabel}
        </div>
      ) : null}
      {changeBadge ? (
        <div style={{
          marginTop: 18,
          display: "inline-flex",
          alignSelf: "flex-start",
          padding: "10px 16px",
          background: `${accentColor}22`,
          border: `2px solid ${accentColor}`,
          borderRadius: 8,
          fontFamily: FONT,
          fontSize: 32,
          fontWeight: 950,
          color: accentColor,
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}>
          {changeBadge}
        </div>
      ) : null}
    </div>
  </div>
);

const ImpactColumn: React.FC<{
  slots: ThumbnailImpactSlot[];
  accentColor: string;
}> = ({ slots, accentColor }) => {
  const top = 160;
  const visible = slots.slice(0, 3);
  return (
    <div style={{
      position: "absolute",
      top,
      right: 64,
      width: 380,
      display: "flex",
      flexDirection: "column",
      gap: 24,
    }}>
      {visible.map((slot, i) => (
        <ImpactCell key={i} slot={slot} accentColor={accentColor} />
      ))}
    </div>
  );
};

const ImpactCell: React.FC<{
  slot: ThumbnailImpactSlot;
  accentColor: string;
}> = ({ slot, accentColor }) => (
  <div style={{
    display: "flex",
    alignItems: "center",
    gap: 18,
    padding: "16px 20px",
    background: `${accentColor}10`,
    border: `2px solid ${accentColor}55`,
    borderRadius: 14,
  }}>
    <div style={{
      width: 96,
      height: 96,
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: `${accentColor}18`,
      border: `1.5px solid ${accentColor}88`,
      borderRadius: 12,
    }}>
      <Icon iconKey={slot.icon} color={accentColor} size={68} strokeWidth={2.6} />
    </div>
    <div style={{
      fontFamily: FONT,
      fontSize: 36,
      fontWeight: 950,
      color: BRAND.text,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      lineHeight: 1.1,
    }}>
      {slot.label}
    </div>
  </div>
);

const BottomStrip: React.FC<{
  accentColor: string;
  text: string;
  brandName: string;
  publishedDate?: string | null;
}> = ({ accentColor, text, brandName, publishedDate }) => (
  <div style={{
    position: "absolute",
    bottom: 48,
    left: 64,
    right: 64,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  }}>
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
    }}>
      <div style={{
        width: 12,
        height: 56,
        background: accentColor,
        borderRadius: 3,
        boxShadow: `0 0 18px ${accentColor}88`,
      }} />
      <div style={{
        fontFamily: FONT,
        fontSize: 44,
        fontWeight: 900,
        color: BRAND.text,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        lineHeight: 1,
      }}>
        {text}
      </div>
    </div>

    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: 6,
    }}>
      <div style={{
        fontFamily: FONT,
        fontSize: 38,
        fontWeight: 950,
        color: accentColor,
        letterSpacing: 4,
        textTransform: "uppercase",
        lineHeight: 1,
      }}>
        {brandName}
      </div>
      {publishedDate ? (
        <div style={{
          fontFamily: FONT,
          fontSize: 18,
          fontWeight: 700,
          color: BRAND.dim,
          letterSpacing: 1.4,
          textTransform: "uppercase",
        }}>
          {publishedDate}
        </div>
      ) : null}
    </div>
  </div>
);

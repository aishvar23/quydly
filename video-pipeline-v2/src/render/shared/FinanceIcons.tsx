import React from "react";

// Programmatic SVG icon library for the finance lane. No licensing risk.
// Each icon takes color + size + optional opacity. Stroke-based so the
// icons read at any scale and the accent color drives editorial coherence
// with the rest of the module surface.

type IconProps = {
  size?: number;
  color: string;
  secondary?: string;  // accent fill for variations
  strokeWidth?: number;
  opacity?: number;
};

const SW = 1.6; // base stroke weight as a ratio of size/24

function strokeFor(size: number, customWidth?: number): number {
  if (customWidth !== undefined) return customWidth;
  return Math.max(1.4, (size / 24) * SW);
}

// ─── Bank / Institution ──────────────────────────────────────────────────────

export const BankIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <path d="M6 26 L32 10 L58 26" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      <line x1="6" y1="26" x2="58" y2="26" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="12" y1="30" x2="12" y2="48" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="22" y1="30" x2="22" y2="48" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="32" y1="30" x2="32" y2="48" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="42" y1="30" x2="42" y2="48" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="52" y1="30" x2="52" y2="48" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="6" y1="52" x2="58" y2="52" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <circle cx="32" cy="20" r="2" fill={color} />
    </svg>
  );
};

// ─── House / Mortgage ────────────────────────────────────────────────────────

export const HouseIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <path d="M8 30 L32 10 L56 30 L56 54 L8 54 Z" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      <path d="M22 54 L22 38 L42 38 L42 54" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      <line x1="32" y1="38" x2="32" y2="54" stroke={color} strokeWidth={sw} />
    </svg>
  );
};

// ─── Piggy bank / Savings ────────────────────────────────────────────────────

export const PiggyBankIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <path
        d="M14 42 C14 28 24 20 36 20 C46 20 54 26 54 36 C54 42 51 47 47 50 L47 56 L42 56 L42 52 L26 52 L26 56 L21 56 L21 49 C17 47 14 44 14 42 Z"
        stroke={color}
        strokeWidth={sw}
        fill="none"
        strokeLinejoin="round"
      />
      {/* coin slot */}
      <line x1="34" y1="22" x2="40" y2="22" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* eye */}
      <circle cx="44" cy="34" r="1.6" fill={color} />
      {/* ear */}
      <path d="M30 22 L26 16 L36 18" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      {/* coin dropping */}
      <circle cx="37" cy="14" r="3" stroke={color} strokeWidth={sw} fill="none" />
      <text x="37" y="17" fontSize="6" textAnchor="middle" fill={color} fontFamily="Arial" fontWeight="bold">$</text>
    </svg>
  );
};

// ─── Credit card ─────────────────────────────────────────────────────────────

export const CreditCardIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <rect x="8" y="16" width="48" height="32" rx="3" stroke={color} strokeWidth={sw} fill="none" />
      <line x1="8" y1="24" x2="56" y2="24" stroke={color} strokeWidth={sw} />
      <rect x="14" y="34" width="12" height="8" rx="1" stroke={color} strokeWidth={sw} fill="none" />
      <line x1="34" y1="38" x2="50" y2="38" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="38" y1="42" x2="50" y2="42" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </svg>
  );
};

// ─── Dollar bill ─────────────────────────────────────────────────────────────

export const DollarBillIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <rect x="6" y="16" width="52" height="32" rx="2" stroke={color} strokeWidth={sw} fill="none" />
      <circle cx="32" cy="32" r="9" stroke={color} strokeWidth={sw} fill="none" />
      <text x="32" y="36" fontSize="14" textAnchor="middle" fill={color} fontFamily="Arial" fontWeight="bold">$</text>
      <circle cx="14" cy="22" r="1.6" fill={color} />
      <circle cx="50" cy="42" r="1.6" fill={color} />
    </svg>
  );
};

// ─── Down arrow / rate cut ───────────────────────────────────────────────────

export const DownArrowIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <line x1="32" y1="10" x2="32" y2="50" stroke={color} strokeWidth={sw + 1.2} strokeLinecap="round" />
      <path d="M16 38 L32 54 L48 38" stroke={color} strokeWidth={sw + 1.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

export const UpArrowIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <line x1="32" y1="54" x2="32" y2="14" stroke={color} strokeWidth={sw + 1.2} strokeLinecap="round" />
      <path d="M16 26 L32 10 L48 26" stroke={color} strokeWidth={sw + 1.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// ─── Scales / Committee ──────────────────────────────────────────────────────

export const ScalesIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <line x1="32" y1="10" x2="32" y2="52" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="14" y1="14" x2="50" y2="14" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="20" y1="52" x2="44" y2="52" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* left pan */}
      <path d="M14 14 L8 28 C8 32 12 34 16 34 C20 34 24 32 22 28 Z" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      {/* right pan */}
      <path d="M50 14 L44 28 C44 32 48 34 52 34 C56 34 58 32 56 28 Z" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
    </svg>
  );
};

// ─── Capitol dome / Government ───────────────────────────────────────────────

export const CapitolIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      {/* dome */}
      <path d="M16 32 C16 22 22 16 32 16 C42 16 48 22 48 32" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
      <line x1="32" y1="10" x2="32" y2="16" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <circle cx="32" cy="9" r="1.4" fill={color} />
      {/* base */}
      <line x1="12" y1="32" x2="52" y2="32" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      {/* columns */}
      <line x1="18" y1="34" x2="18" y2="50" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="26" y1="34" x2="26" y2="50" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="32" y1="34" x2="32" y2="50" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="38" y1="34" x2="38" y2="50" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="46" y1="34" x2="46" y2="50" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <line x1="10" y1="50" x2="54" y2="50" stroke={color} strokeWidth={sw + 0.4} strokeLinecap="round" />
    </svg>
  );
};

// ─── Shopping / Inflation ────────────────────────────────────────────────────

export const ShoppingCartIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <path d="M8 12 L14 12 L20 38 L48 38 L52 22 L18 22" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="24" cy="48" r="3" stroke={color} strokeWidth={sw} fill="none" />
      <circle cx="44" cy="48" r="3" stroke={color} strokeWidth={sw} fill="none" />
    </svg>
  );
};

// ─── Briefcase / Jobs ────────────────────────────────────────────────────────

export const BriefcaseIcon: React.FC<IconProps> = ({
  size = 64, color, strokeWidth, opacity = 1,
}) => {
  const s = size;
  const sw = strokeFor(s, strokeWidth);
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" style={{ opacity }}>
      <rect x="8" y="20" width="48" height="32" rx="2" stroke={color} strokeWidth={sw} fill="none" />
      <path d="M22 20 L22 14 L42 14 L42 20" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      <line x1="8" y1="32" x2="56" y2="32" stroke={color} strokeWidth={sw} />
      <rect x="28" y="29" width="8" height="6" stroke={color} strokeWidth={sw} fill="none" />
    </svg>
  );
};

// ─── Auto-pick by topic keyword ──────────────────────────────────────────────
// Maps the "who" string from an ImpactCard item to an icon. Falls back
// to DollarBillIcon when nothing matches.

export type FinanceIconKey =
  | "house" | "mortgage"
  | "piggy" | "savings"
  | "credit" | "card" | "debt"
  | "bank"
  | "dollar" | "money"
  | "down" | "rateCut"
  | "up" | "rateHike"
  | "scales" | "committee"
  | "capitol" | "government"
  | "shopping" | "inflation"
  | "briefcase" | "jobs";

export function pickIconForWho(who: string): FinanceIconKey {
  const w = String(who).toLowerCase();
  if (/mortgage|home|hous/.test(w)) return "house";
  if (/savings?|piggy|deposit/.test(w)) return "piggy";
  if (/credit|card|debt|loan/.test(w)) return "credit";
  if (/job|employ|work|labor/.test(w)) return "briefcase";
  if (/groce|shop|price/.test(w)) return "shopping";
  if (/borrow|spending/.test(w)) return "dollar";
  return "dollar";
}

export const Icon: React.FC<IconProps & { iconKey: FinanceIconKey }> = ({ iconKey, ...rest }) => {
  switch (iconKey) {
    case "house":
    case "mortgage":   return <HouseIcon {...rest} />;
    case "piggy":
    case "savings":    return <PiggyBankIcon {...rest} />;
    case "credit":
    case "card":
    case "debt":       return <CreditCardIcon {...rest} />;
    case "bank":       return <BankIcon {...rest} />;
    case "dollar":
    case "money":      return <DollarBillIcon {...rest} />;
    case "down":
    case "rateCut":    return <DownArrowIcon {...rest} />;
    case "up":
    case "rateHike":   return <UpArrowIcon {...rest} />;
    case "scales":
    case "committee":  return <ScalesIcon {...rest} />;
    case "capitol":
    case "government": return <CapitolIcon {...rest} />;
    case "shopping":
    case "inflation":  return <ShoppingCartIcon {...rest} />;
    case "briefcase":
    case "jobs":       return <BriefcaseIcon {...rest} />;
    default:           return <DollarBillIcon {...rest} />;
  }
};

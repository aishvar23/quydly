// Vertical anchor vocabulary. Modules pin content to ZONE.* not to magic numbers.
// Change a value here, every module shifts together.
export const ZONE = {
  postureChip: 140,
  eyebrow:     252,
  hero:        360,
  heroStrong:  580,
  bodyMid:     900,
  bodyLate:    1100,
  closing:     1240,
  footerChip:  1500,
} as const;

export type ZoneKey = keyof typeof ZONE;

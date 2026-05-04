import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";

export const EASE = {
  out:   Easing.bezier(0.16, 1.0, 0.30, 1.0),
  in:    Easing.bezier(0.50, 0.0, 0.75, 0.0),
  inOut: Easing.bezier(0.65, 0.0, 0.35, 1.0),
  punch: Easing.bezier(0.20, 1.30, 0.30, 1.0),
} as const;

export const BEAT = {
  flash: 6,
  quick: 10,
  short: 18,
  base:  24,
  long:  36,
  hold:  48,
} as const;

export const SPRINGS = {
  soft:  { damping: 22, stiffness: 110, mass: 0.95 },
  crisp: { damping: 18, stiffness: 150, mass: 0.80 },
  pop:   { damping: 14, stiffness: 220, mass: 0.65 },
} as const;

export function useBeat(startFrame: number, durationFrames: number, easing = EASE.out): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

export function useSpringIn(startFrame: number, preset: keyof typeof SPRINGS = "crisp"): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: Math.max(0, frame - startFrame),
    fps,
    config: SPRINGS[preset],
    durationInFrames: BEAT.short,
  });
}

export function useCountUp(target: number, startFrame: number, durationFrames: number = BEAT.long): number {
  const progress = useBeat(startFrame, durationFrames, EASE.out);
  return Math.round(progress * target);
}

export function useDrawIn(startFrame: number, durationFrames: number = BEAT.short): number {
  return useBeat(startFrame, durationFrames, EASE.out);
}

export function useRiseIn(
  startFrame: number,
  distancePx: number = 28,
  preset: keyof typeof SPRINGS = "soft",
): { translateY: number; opacity: number } {
  const progress = useSpringIn(startFrame, preset);
  return {
    translateY: interpolate(progress, [0, 1], [distancePx, 0]),
    opacity: interpolate(progress, [0, 0.25], [0, 1], { extrapolateRight: "clamp" }),
  };
}

export function useFadeIn(startFrame: number, durationFrames: number = BEAT.short): number {
  return useBeat(startFrame, durationFrames, EASE.out);
}

export function useStaggered(
  startFrame: number,
  index: number,
  gap: number = BEAT.flash,
  durationFrames: number = BEAT.short,
): number {
  return useBeat(startFrame + index * gap, durationFrames, EASE.out);
}

// Slow ambient breathing scale: 1.0 -> 1.0 + amplitude -> 1.0, period in frames.
// Use during static holds so cards do not freeze.
export function useBreath(
  startFrame: number,
  periodFrames: number = 90,
  amplitude: number = 0.012,
): number {
  const frame = useCurrentFrame();
  const t = Math.max(0, frame - startFrame);
  const phase = (t / periodFrames) * Math.PI * 2;
  return 1.0 + (1 - Math.cos(phase)) * 0.5 * amplitude;
}

export function pickText(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// ─── Wipe ───────────────────────────────────────────────────────────────────
// Returns 0→1 progress for a left-to-right wipe starting at `delay` frames.
export function useWipe(delay = 0, durationFrames = 14): number {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

// ─── Spring entrance ────────────────────────────────────────────────────────
// Returns 0→1 spring progress starting at `delay` frames.
export function useSpringEntrance(
  delay = 0,
  config = { damping: 20, stiffness: 110, mass: 0.85 }
): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: Math.max(0, frame - delay),
    fps,
    config,
    durationInFrames: 22,
  });
}

// ─── Fade in ────────────────────────────────────────────────────────────────
export function useFadeIn(delay = 0, durationFrames = 10): number {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

// ─── Text rise (clip-mask reveal) ───────────────────────────────────────────
// Returns a translateY percentage 100→0 that reveals text rising from below a
// hidden overflow container. Use with a container of `overflow: hidden`.
export function useTextRise(delay = 0): { translatePct: number; opacity: number } {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 24, stiffness: 100, mass: 1.0 },
    durationInFrames: 20,
  });
  return {
    translatePct: interpolate(progress, [0, 1], [100, 0]),
    opacity: interpolate(progress, [0, 0.15], [0, 1], { extrapolateRight: "clamp" }),
  };
}

// ─── Slide from right ───────────────────────────────────────────────────────
export function useSlideFromRight(delay = 0, distance = 60): { x: number; opacity: number } {
  const progress = useSpringEntrance(delay);
  return {
    x: interpolate(progress, [0, 1], [distance, 0]),
    opacity: interpolate(progress, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }),
  };
}

// ─── Slide from bottom ──────────────────────────────────────────────────────
export function useSlideFromBottom(delay = 0, distance = 50): { y: number; opacity: number } {
  const progress = useSpringEntrance(delay);
  return {
    y: interpolate(progress, [0, 1], [distance, 0]),
    opacity: interpolate(progress, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }),
  };
}

// ─── Scale in ───────────────────────────────────────────────────────────────
export function useScaleIn(
  delay = 0,
  fromScale = 0.85,
  config = { damping: 18, stiffness: 130, mass: 0.8 }
): { scale: number; opacity: number } {
  const progress = useSpringEntrance(delay, config);
  return {
    scale: interpolate(progress, [0, 1], [fromScale, 1.0]),
    opacity: interpolate(progress, [0, 0.25], [0, 1], { extrapolateRight: "clamp" }),
  };
}

// ─── Pulse (for pins/rings) ──────────────────────────────────────────────────
// Returns a 0→1→0 pulse value at `cycleFrames` period.
export function usePulse(cycleFrames = 40): number {
  const frame = useCurrentFrame();
  return 0.5 + 0.5 * Math.sin((frame / cycleFrames) * Math.PI * 2);
}

// ─── Ken Burns ───────────────────────────────────────────────────────────────
export function useKenBurns(
  direction: "zoom-in" | "zoom-out",
  startScale: number,
  endScale: number
): number {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [0, durationInFrames], [startScale, endScale], {
    extrapolateRight: "clamp",
  });
}

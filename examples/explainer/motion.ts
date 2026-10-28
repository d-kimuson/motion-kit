// The explainer's motion vocabulary, as plain arithmetic on a scene's local seconds. /motion has no
// public subpath yet, so the spring is a closed form written here, and the arrivals every scene
// uses are named here once: a scene says `rise(t, at)` and gets the same curve as every other one.
import { type CSSProperties } from 'react';

import { clamp01, easeInCubic, easeOutCubic } from './look.ts';

/**
 * Step response of an underdamped spring released from rest toward 1 at t = 0: it overshoots by a
 * few percent before settling. The same closed form as the teaser's, kept here rather than
 * imported so retuning the teaser's spring cannot move the explainer's motion. (The chart JSON is
 * shared on purpose, in `scenes/datasets.ts`, because both must draw the same data.) Both copies
 * go once `/motion` has a public spring.
 */
export const springStep = (seconds: number, damping = 0.72, omega = 12): number => {
  if (!(seconds > 0)) return 0;
  const damped = omega * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * omega * seconds);
  return (
    1 -
    decay * (Math.cos(damped * seconds) + ((damping * omega) / damped) * Math.sin(damped * seconds))
  );
};

/** 0 before `at`, 1 after `at + duration`, linear between. */
export const progress = (t: number, at: number, duration: number): number =>
  duration <= 0 ? (t >= at ? 1 : 0) : clamp01((t - at) / duration);

/** An eased arrival that starts at `at`. */
export const enter = (t: number, at: number, duration = 0.5): number =>
  easeOutCubic(progress(t, at, duration));

/** An eased departure that starts at `at`: 1, falling to 0. */
export const leave = (t: number, at: number, duration = 0.4): number =>
  1 - easeInCubic(progress(t, at, duration));

/** A smooth 0→1→0 window: in over `fade` from `from`, out over `fade` until `to`. */
export const windowed = (t: number, from: number, to: number, fade = 0.35): number =>
  Math.min(enter(t, from, fade), leave(t, to - fade, fade));

export const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount;

/** Fades in while sliding `distance` px up into place. */
export const rise = (t: number, at: number, distance = 32, duration = 0.55): CSSProperties => {
  const amount = enter(t, at, duration);
  return { opacity: amount, transform: `translateY(${String((1 - amount) * distance)}px)` };
};

/** Fades in while springing from `from` scale to full size, overshooting a little. */
export const popIn = (t: number, at: number, from = 0.6): CSSProperties => {
  const spring = springStep(t - at, 0.55, 14);
  return {
    opacity: progress(t, at, 0.14),
    transform: `scale(${String(lerp(from, 1, spring))})`,
  };
};

/** Fades in while sliding in from the left (`distance` < 0 slides in from the right). */
export const slideIn = (t: number, at: number, distance = 48, duration = 0.6): CSSProperties => {
  const amount = enter(t, at, duration);
  return { opacity: amount, transform: `translateX(${String((amount - 1) * distance)}px)` };
};

/** The `index`th of a run that starts at `at`, `gap` seconds apart. */
export const stagger = (at: number, index: number, gap: number): number => at + index * gap;

/** A counter that runs from `from` to `to` over `duration`, easing out as it lands. */
export const countUp = (t: number, at: number, to: number, duration = 1.2, from = 0): number =>
  lerp(from, to, enter(t, at, duration));

/** A slow sway for things that should feel alive while they wait: ±`amount` around 0. */
export const sway = (t: number, period = 4, amount = 1): number =>
  Math.sin((t / period) * Math.PI * 2) * amount;

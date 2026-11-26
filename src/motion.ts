// Shared motion language (Motion for React). One easing curve, one spring, a few reusable variants.
// MotionConfig reducedMotion="user" (in App) turns movement off for people who ask for reduced motion;
// opacity fades remain so content still appears gently.

import type { Transition, Variants } from 'motion/react';

/** Soft deceleration used across the app. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** A quick, well-damped spring for things that respond to the person (taps, bubbles, the nav pill). */
export const SPRING: Transition = { type: 'spring', stiffness: 460, damping: 36, mass: 0.8 };

/** Parent that reveals its children one after another. */
export const stagger = (gap = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

/**
 * Springs with no bounce for things that simply arrive or change size: they start from the current value and carry
 * its velocity, so an interrupted animation never jumps. `visualDuration` is the time to (visually) settle.
 */
export const SETTLE: Transition = { type: 'spring', bounce: 0, visualDuration: 0.38 };
export const SETTLE_FAST: Transition = { type: 'spring', bounce: 0, visualDuration: 0.26 };

/** Sheets (phone assistant, policy sheet): open and close along the same path. */
export const SHEET_SPRING: Transition = { type: 'spring', bounce: 0, visualDuration: 0.35 };
/** After a flick, a little bounce carries the release velocity. */
export const SHEET_FLICK = (velocity: number): Transition => ({ type: 'spring', bounce: 0.15, visualDuration: 0.35, velocity });
/** Desktop side panel: a touch quicker. */
export const PANEL_SPRING: Transition = { type: 'spring', bounce: 0, visualDuration: 0.3 };

/** Where a flick would come to rest: Apple's project(v, decelerationRate 0.998), with v in px/s. */
export const project = (velocity: number, decelerationRate = 0.998) => ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

/** Child that fades and rises into place. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: SETTLE },
};

/** Smaller rise for dense items (list rows, chips). */
export const riseSm: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: SETTLE_FAST },
};

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

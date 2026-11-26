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

/** Child that fades and rises into place. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
};

/** Smaller rise for dense items (list rows, chips). */
export const riseSm: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
};

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

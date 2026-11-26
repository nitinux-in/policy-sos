// One spring-driven sheet behaviour, shared by the phone assistant (full screen) and the policy sheet (bottom sheet
// on phones, right-hand panel on wider screens).
//
// - Opens and closes along the same path for every close route (Back, Escape, scrim tap, swipe): the parent just
//   flips `open`, and the sheet springs from wherever it currently is.
// - Interruptible: grabbing it mid-animation stops the spring and tracks the finger 1:1 from the grab point.
// - Rubber-bands past the open position; on release the flick is projected (Apple's project(v, 0.998)) and the
//   projected resting point decides dismiss vs stay. The release velocity is handed to the spring.
// - `progress` (0 closed → 1 open) drives the scrim, so the background dims in proportion to the drag.
// - Reduced motion: no slide; the sheet appears and disappears in place (direct dragging still tracks the finger).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { animate, useMotionValue, useReducedMotion, useTransform, type MotionValue, type Transition } from 'motion/react';
import { PANEL_SPRING, SHEET_FLICK, SHEET_SPRING, project } from './motion';

type Axis = 'y' | 'x';

export interface SpringSheet {
  /** Render the sheet while this is true (open, or still animating closed). */
  present: boolean;
  /** Offset from the open position in px, along the sheet's axis (0 = open). */
  offset: MotionValue<number>;
  /** 0 when closed, 1 when fully open; follows the drag. */
  progress: MotionValue<number>;
  /** Spread on the drag handle / header. Taps on buttons inside still work (dragging starts after a few px). */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
  };
}

const SLOP = 5; // px of movement before a press becomes a drag

export function useSpringSheet({
  open,
  onDismiss,
  panelRef,
  axis = 'y',
  draggable = true,
  scrollRef,
}: {
  open: boolean;
  onDismiss: () => void;
  panelRef: RefObject<HTMLElement | null>;
  axis?: Axis;
  draggable?: boolean;
  /** Also drag from this scroll area when it's scrolled to the top and the finger moves down (touch only). */
  scrollRef?: RefObject<HTMLElement | null>;
}): SpringSheet {
  const reduce = useReducedMotion();
  const sizeRef = useRef(typeof window === 'undefined' ? 1000 : axis === 'y' ? window.innerHeight : 560);
  const offset = useMotionValue(sizeRef.current);
  const progress = useTransform(offset, (v) => 1 - Math.min(1, Math.max(0, v / (sizeRef.current || 1))));
  const [exiting, setExiting] = useState(false);
  const shown = useRef(false);
  const token = useRef(0);
  const exitTransition = useRef<Transition | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const base = axis === 'y' ? SHEET_SPRING : PANEL_SPRING;

  /** Distance from open to fully off screen. */
  const size = useCallback(() => {
    const el = panelRef.current;
    const measured = el ? (axis === 'y' ? el.offsetHeight : el.offsetWidth + 24) : 0; // + side-panel margin
    if (measured) sizeRef.current = measured;
    return sizeRef.current;
  }, [panelRef, axis]);

  // Open / close: always from the current value, so a close during an open (or the reverse) just turns around
  useLayoutEffect(() => {
    const t = ++token.current;
    if (open) {
      setExiting(false);
      if (reduce) { offset.stop(); offset.set(0); shown.current = true; return; }
      if (!shown.current) offset.set(size());
      shown.current = true;
      animate(offset, 0, base);
    } else if (shown.current) {
      const transition = exitTransition.current ?? base;
      exitTransition.current = null;
      if (reduce) { offset.stop(); offset.set(size()); shown.current = false; return; }
      setExiting(true);
      animate(offset, size(), transition).then(() => {
        if (t !== token.current) return; // reopened meanwhile
        shown.current = false;
        setExiting(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------- dragging ----------
  const drag = useRef<{ start: number; from: number; samples: { t: number; p: number }[] } | null>(null);
  const pending = useRef<{ id: number; start: number } | null>(null);

  const begin = (pos: number) => {
    offset.stop(); // interrupt any running spring: the sheet stays under the finger
    drag.current = { start: pos, from: offset.get(), samples: [{ t: performance.now(), p: pos }] };
  };
  const move = (pos: number) => {
    const d = drag.current;
    if (!d) return;
    let v = d.from + (pos - d.start);
    if (v < 0) {
      // Rubber band past the open position
      const dim = size();
      v = -(1 - 1 / ((-v * 0.55) / dim + 1)) * dim;
    }
    offset.set(v);
    const now = performance.now();
    d.samples.push({ t: now, p: pos });
    while (d.samples.length > 2 && now - d.samples[0].t > 100) d.samples.shift();
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const now = performance.now();
    const recent = d.samples.filter((s) => now - s.t < 100);
    const first = recent[0] ?? d.samples[d.samples.length - 1];
    const last = d.samples[d.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    const velocity = dt > 0 ? (last.p - first.p) / dt : 0; // px/s, positive = toward closed
    const current = offset.get();
    const dim = size();
    if (current > 0 && current + project(velocity) > dim / 2) {
      exitTransition.current = SHEET_FLICK(velocity);
      dismissRef.current();
    } else if (reduce) {
      offset.set(0);
    } else {
      animate(offset, 0, SHEET_FLICK(velocity));
    }
  };

  const coord = (e: { clientX: number; clientY: number }) => (axis === 'y' ? e.clientY : e.clientX);
  const handleProps: SpringSheet['handleProps'] = {
    onPointerDown: (e) => {
      if (!draggable || e.button !== 0) return;
      pending.current = { id: e.pointerId, start: coord(e) };
    },
    onPointerMove: (e) => {
      if (drag.current) { move(coord(e)); return; }
      const p = pending.current;
      if (!p || p.id !== e.pointerId) return;
      if (Math.abs(coord(e) - p.start) < SLOP) return;
      // Only now capture the pointer, so a plain tap still reaches buttons in the header
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      pending.current = null;
      begin(p.start);
      move(coord(e));
    },
    onPointerUp: () => { pending.current = null; end(); },
    onPointerCancel: () => { pending.current = null; end(); },
  };

  // Touch drag from the content when it's scrolled to the top (the assistant's conversation)
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el || !draggable || axis !== 'y') return;
    let startX = 0, startY = 0, tracking = false, engaged = false;
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = el.scrollTop <= 0;
      engaged = false;
    };
    const tm = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (!engaged) {
        if (dy > SLOP && dy > Math.abs(dx) && el.scrollTop <= 0) { engaged = true; begin(t.clientY); }
        else if (dy < -2 || Math.abs(dx) > SLOP) { tracking = false; return; }
        else return;
      }
      e.preventDefault(); // the sheet moves instead of the page bouncing
      move(t.clientY);
    };
    const te = () => { if (engaged) end(); tracking = false; engaged = false; };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('touchcancel', te);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, draggable, axis, open]);

  return { present: open || exiting, offset, progress, handleProps };
}

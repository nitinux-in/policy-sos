// Shared UI primitives: buttons, badges, disclosures and accessible dialogs.

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { ChevronDown, Moon, Sun, X } from 'lucide-react';
import type { Category, Policy } from '../shared/types';
import { categoryMeta, policyStatus } from './lib';

// ---------- class recipes ----------

export const btn = {
  primary:
    'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 text-[15px] font-semibold text-white transition-colors hover:bg-primary-strong active:bg-primary-strong disabled:bg-line disabled:text-ink-3',
  secondary:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink-3/40 hover:bg-page active:bg-line-2',
  quiet:
    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-[14px] font-medium text-link transition-colors hover:bg-primary-tint',
  icon: 'inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-line-2 active:bg-line',
};

export const card = 'rounded-2xl border border-line bg-surface shadow-card';

// ---------- small display pieces ----------

export function CategoryIcon({ c, size = 'md' }: { c: Category; size?: 'sm' | 'md' }) {
  const m = categoryMeta(c);
  const box = size === 'sm' ? 'h-9 w-9 rounded-lg' : 'h-11 w-11 rounded-xl';
  return (
    <span className={`grid ${box} shrink-0 place-items-center bg-primary-tint text-link`} aria-hidden="true">
      <m.icon size={size === 'sm' ? 17 : 20} strokeWidth={1.9} />
    </span>
  );
}

const STATUS_STYLE = {
  active: 'bg-ok-bg text-ok',
  renewing: 'bg-warn-bg text-warn',
  expired: 'bg-bad-bg text-bad',
  lapsed: 'bg-bad-bg text-bad',
} as const;

export function StatusPill({ p }: { p: Policy }) {
  const s = policyStatus(p);
  return <Pill className={STATUS_STYLE[s.kind]}>{s.label}</Pill>;
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ${className}`}>{children}</span>;
}

export function SampleBadge({ label = 'Sample data' }: { label?: string }) {
  return <Pill className="border border-line bg-surface text-ink-3">{label}</Pill>;
}

export function ConceptTag() {
  return <Pill className="bg-sun text-sun-ink">Unofficial concept</Pill>;
}

// ---------- disclosure ----------

export function Disclosure({
  summary,
  children,
  className = '',
  buttonClassName = '',
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className={`focus-ring-inset flex w-full items-center justify-between gap-3 text-left ${buttonClassName}`}
      >
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={id} hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}

// ---------- media query ----------

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// ---------- dialog behaviour ----------

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management for overlays: moves focus in on open, returns it to the opener on close,
 * closes on Escape, and (when modal) traps Tab inside and locks page scroll.
 */
export function useOverlay(ref: RefObject<HTMLElement | null>, onClose: () => void, modal: boolean, returnSelector?: string) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    // Some browsers (e.g. Safari) don't focus buttons on click, so fall back to the visible trigger
    const active = document.activeElement as HTMLElement | null;
    const opener = active && active !== document.body ? active : visibleMatch(returnSelector);
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (!modal || e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest('[hidden]'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el?.addEventListener('keydown', onKey);
    const prevOverflow = document.documentElement.style.overflow;
    if (modal) document.documentElement.style.overflow = 'hidden';
    return () => {
      el?.removeEventListener('keydown', onKey);
      if (modal) document.documentElement.style.overflow = prevOverflow;
      const target = opener && document.contains(opener) ? opener : visibleMatch(returnSelector);
      target?.focus({ preventScroll: true });
    };
  }, [ref, modal, returnSelector]);
}

function visibleMatch(selector?: string): HTMLElement | null {
  if (!selector) return null;
  return [...document.querySelectorAll<HTMLElement>(selector)].find((n) => n.offsetParent !== null || getComputedStyle(n).position === 'fixed') ?? null;
}

/** Modal panel: a bottom sheet on phones, a right-hand drawer from tablet width up. */
export function Modal({ labelledBy, onClose, returnSelector, children }: { labelledBy: string; onClose: () => void; returnSelector?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(ref, onClose, true, returnSelector);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end md:flex-row md:justify-end">
      <div className="animate-fade absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="animate-sheet md:animate-drawer relative flex max-h-[90dvh] w-full flex-col rounded-t-3xl bg-surface shadow-float outline-none md:h-full md:max-h-none md:max-w-[520px] md:rounded-none md:rounded-l-3xl"
      >
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={btn.icon} aria-label={label}>
      <X size={20} aria-hidden="true" />
    </button>
  );
}

// ---------- theme ----------

export type Theme = 'light' | 'dark';
const THEME_KEY = 'dic-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#161a1f' };

/** Light by default; a dark choice is remembered on this device only (index.html applies it before first paint). */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
    try {
      if (theme === 'dark') localStorage.setItem(THEME_KEY, 'dark');
      else localStorage.removeItem(THEME_KEY);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button type="button" onClick={onToggle} aria-pressed={dark} aria-label="Dark theme" title={dark ? 'Switch to light theme' : 'Switch to dark theme'} className={btn.icon}>
      {dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
    </button>
  );
}

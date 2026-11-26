// App-level building blocks on top of shadcn/ui (src/components/ui), carrying the Ditto branding.

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { Moon, Sun, X, type LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import type { Category, Policy } from '../shared/types';
import { categoryMeta, policyStatus } from './format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// ---------- brand ----------

/** Ditto wordmark; the dark-theme file has light letterforms and the same blue mark. */
export function DittoLogo({ className = '' }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0', className)}>
      <img src="/brand/ditto-logo.png" alt="Ditto" className="logo-light h-full w-auto" />
      <img src="/brand/ditto-logo-dark.png" alt="Ditto" className="logo-dark h-full w-auto" />
    </span>
  );
}

/** The Ditto mascot's face, used as the assistant's avatar. */
export function MascotAvatar({ className = '' }: { className?: string }) {
  return (
    <span className={cn('inline-grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-accent', className)} aria-hidden="true">
      <img src="/brand/mascot-avatar.png" alt="" className="size-full object-cover" />
    </span>
  );
}

/** The full Ditto mascot (headset and laptop) for assistant surfaces. */
export function Mascot({ className = '' }: { className?: string }) {
  return <img src="/brand/mascot-assistant.png" alt="" aria-hidden="true" className={cn('pointer-events-none select-none object-contain', className)} />;
}

/** Initials avatar for the signed-in person. */
export function PersonAvatar({ name, className = '' }: { name: string; className?: string }) {
  const initials = name.split(' ').map((n) => n[0]).slice(0, 2).join('');
  return (
    <span className={cn('inline-grid size-10 shrink-0 place-items-center rounded-full bg-ink text-[13px] font-semibold text-white dark:bg-accent dark:text-accent-foreground', className)} aria-hidden="true">
      {initials}
    </span>
  );
}

// ---------- small display pieces ----------

export function CategoryIcon({ c, size = 'md' }: { c: Category; size?: 'sm' | 'md' }) {
  const m = categoryMeta(c);
  const box = size === 'sm' ? 'size-9' : 'size-10';
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full bg-accent text-link`} aria-hidden="true">
      <m.icon size={size === 'sm' ? 16 : 18} strokeWidth={1.9} />
    </span>
  );
}

export const TONE = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  neutral: 'bg-muted text-ink-2',
} as const;

/** A status label (shadcn Badge) in one of the restrained status tones. */
export function Pill({ children, tone, className = '' }: { children: ReactNode; tone?: keyof typeof TONE; className?: string }) {
  return <Badge className={cn('px-2 text-[11px] font-medium', tone && TONE[tone], className)}>{children}</Badge>;
}

const STATUS_TONE = { active: 'ok', renewing: 'warn', expired: 'bad', lapsed: 'bad' } as const;

export function StatusPill({ p }: { p: Policy }) {
  const s = policyStatus(p);
  return <Pill tone={STATUS_TONE[s.kind]}>{s.label}</Pill>;
}

// ---------- dashboard building blocks (shadcn Card) ----------

export const surface = 'rounded-3xl border-0 bg-card shadow-card';

/** A titled dashboard card. The body is a container-query context so content adapts to the card's own width. */
export function Panel({ title, action, children, className = '', bodyClassName = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  const id = useId();
  return (
    <Card role="region" aria-labelledby={id} className={cn(surface, 'min-w-0 gap-0 py-0', className)}>
      <div className="flex min-h-14 items-center justify-between gap-3 px-5 pt-2">
        <h2 id={id} className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className={cn('@container min-w-0 flex-1 pb-2', bodyClassName)}>{children}</div>
    </Card>
  );
}

/** A compact summary figure: icon, optional status, label, value. */
export function Stat({ label, value, sub, icon: Icon, badge }: { label: string; value: ReactNode; sub?: ReactNode; icon: LucideIcon; badge?: ReactNode }) {
  return (
    <Card className={cn(surface, 'min-w-0 gap-0 p-4')}>
      <div className="flex items-start justify-between gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-accent text-link" aria-hidden="true"><Icon size={17} /></span>
        {badge}
      </div>
      <p className="mt-3 text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 text-[22px] font-semibold leading-tight tracking-tight @4xl:text-[26px]">{value}</p>
      {sub && <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{sub}</p>}
    </Card>
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

// ---------- overlay behaviour (full-screen assistant on phones) ----------

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus management while `active`: moves focus in, returns it to the opener when deactivated, closes on Escape,
 * and (when modal) traps Tab inside and locks page scroll. Policy details use the shadcn Sheet instead.
 */
export function useOverlay(ref: RefObject<HTMLElement | null>, onClose: () => void, modal: boolean, returnSelector?: string, active = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    // Some browsers (e.g. Safari) don't focus buttons on click, so fall back to the visible trigger
    const current = document.activeElement as HTMLElement | null;
    const opener = current && current !== document.body ? current : visibleMatch(returnSelector);
    const el = ref.current;
    el?.focus({ preventScroll: true });

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
      const target = opener && document.contains(opener) && opener.offsetParent !== null ? opener : visibleMatch(returnSelector);
      target?.focus({ preventScroll: true });
    };
  }, [ref, modal, returnSelector, active]);
}

function visibleMatch(selector?: string): HTMLElement | null {
  if (!selector) return null;
  return [...document.querySelectorAll<HTMLElement>(selector)].find((n) => n.offsetParent !== null || getComputedStyle(n).position === 'fixed') ?? null;
}

export function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} aria-label={label} className="text-ink-2">
      <X className="size-5" aria-hidden="true" />
    </Button>
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

/** Icon-only theme button. */
export function ThemeToggle({ theme, onToggle, className = '' }: { theme: Theme; onToggle: () => void; className?: string }) {
  const dark = theme === 'dark';
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onToggle} aria-pressed={dark} aria-label="Dark theme" title={dark ? 'Switch to light theme' : 'Switch to dark theme'} className={cn('bg-card text-ink-2 shadow-card hover:bg-card/80', className)}>
      {dark ? <Sun className="size-[18px]" aria-hidden="true" /> : <Moon className="size-[18px]" aria-hidden="true" />}
    </Button>
  );
}

// Home dashboard: ask first, then what needs attention, who's covered, the policies and what to know about them.
// Every figure and suggestion is derived from the portfolio by shared/insights.ts, so nothing here is hard-coded.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, ArrowUpRight, Check, ChevronRight, FileText, Info, Receipt, Search, ShieldCheck, TriangleAlert, CircleCheck } from 'lucide-react';
import { m, useReducedMotion, useSpring } from 'motion/react';
import type { Policy, PortfolioData } from '../shared/types';
import {
  coverageMatrix, formatDate, needsAttention, summaryFigures, thingsToKnow,
  type AttentionItem, type AttentionTone, type CoverageMatrix,
} from '../shared/insights';
import { categoryMeta, daysUntil, fmtMoney } from './format';
import { FEATURED } from './prompts';
import { CategoryIcon, Mascot, MascotAvatar, Panel, Pill, SEND_BUTTON, surface, TONE } from './ui';
import type { Tab } from './App';
import { explainPrompt } from './screens';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { rise, riseSm, SPRING, stagger } from './motion';

const money = (n: number) => fmtMoney({ currency: 'INR' }, n, true);
const shortDate = (iso: string) => formatDate(iso).replace(/ \d{4}$/, ''); // "31 Mar"

const viewAll = (onClick: () => void, label = 'View all') => (
  <Button type="button" variant="ghost" size="sm" onClick={onClick} className="-mr-2 h-10 text-[13px] font-medium text-link hover:text-link">
    {label} <ChevronRight className="size-4" aria-hidden="true" />
  </Button>
);

export function OverviewScreen({ data, onOpenPolicy, onAsk, onNavigate }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void; onAsk: (q?: string) => void; onNavigate: (t: Tab) => void }) {
  const attention = useMemo(() => needsAttention(data), [data]);
  const matrix = useMemo(() => coverageMatrix(data), [data]);
  const insights = useMemo(() => thingsToKnow(data), [data]);
  const figures = useMemo(() => summaryFigures(data), [data]);
  const first = data.user.name.split(' ')[0];

  // "Try asking": short labels for questions drawn from this person's own policies, plus one curated demo question.
  // The label is what's shown; the full question is what gets asked.
  const chips = useMemo(() => {
    const featured = FEATURED.find((f) => !f.urgent);
    const list: Chip[] = [
      ...[insights[0], insights[2], insights[3]].filter(Boolean).map((i) => ({ label: i.title, q: i.prompt })),
      ...(featured ? [{ label: featured.hint, q: featured.q }] : []),
    ];
    return list.filter((c, i) => list.findIndex((x) => x.q === c.q) === i).slice(0, 4);
  }, [insights]);

  const act = (item: AttentionItem) => {
    const a = item.action;
    if (a.kind === 'ask') onAsk(a.prompt);
    else if (a.kind === 'documents') onNavigate('documents');
    else { const p = data.policies.find((x) => x.id === a.policyId); if (p) onOpenPolicy(p); }
  };

  return (
    <m.div initial="hidden" animate="show" variants={stagger(0.08)} className="space-y-4 pt-2 @4xl:pt-4">
      <m.div variants={rise} className="grid gap-4 @4xl:grid-cols-12">
        <AskCard firstName={first} chips={chips} onAsk={onAsk} className="@4xl:col-span-8" />
        <NeedsAttention items={attention} onAct={act} className="@4xl:col-span-4" />
      </m.div>

      <m.div variants={rise} className="grid items-start gap-4 @4xl:grid-cols-12">
        <KeyFigures f={figures} className="@4xl:col-span-4" />
        <WhosCovered mx={matrix} className="@4xl:col-span-8" />
      </m.div>

      <m.div variants={rise} className="grid items-start gap-4 @4xl:grid-cols-12">
        {/* Phones: the column dissolves so Activity can follow Things to know */}
        <div className="contents @4xl:col-span-7 @4xl:grid @4xl:gap-4">
          <YourPolicies policies={data.policies} onOpen={onOpenPolicy} onAsk={onAsk} onViewAll={() => onNavigate('policies')} />
          <Activity data={data} onNavigate={onNavigate} className="order-last @4xl:order-none" />
        </div>
        <Panel title="Things to know" className="@4xl:col-span-5">
          <ul className="px-2 pb-1">
            {insights.slice(0, 5).map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => onAsk(i.prompt)} className="focus-ring-inset group flex w-full items-center gap-3 rounded-tile px-3 py-2.5 text-left transition-colors hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{i.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{i.detail}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </m.div>
    </m.div>
  );
}

// ---------- Ask card ----------

/** Types out example questions one after another while `enabled` (the field is empty and not focused). */
function useTypedExamples(examples: string[], enabled: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!enabled || !examples.length) { setText(''); return; }
    let i = 0, n = 0, deleting = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = examples[i % examples.length];
      if (!deleting) {
        n++;
        setText(full.slice(0, n));
        if (n >= full.length) { deleting = true; t = setTimeout(tick, 1800); return; }
        t = setTimeout(tick, 38 + Math.random() * 30);
      } else {
        n = Math.max(0, n - 2);
        setText(full.slice(0, n));
        if (n === 0) { deleting = false; i++; t = setTimeout(tick, 350); return; }
        t = setTimeout(tick, 18);
      }
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [enabled, examples]);
  return text;
}

type Chip = { label: string; q: string };

function AskCard({ firstName, chips, onAsk, className = '' }: { firstName: string; chips: Chip[]; onAsk: (q?: string) => void; className?: string }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const examples = useMemo(() => chips.map((c) => c.q), [chips]);
  const typed = useTypedExamples(examples, !reduce && !focused && !q);
  const showTyped = !reduce && !focused && !q;

  // The mascot leans toward the pointer (small range), toward the field when it's focused, and hops on submit
  const rotate = useSpring(0, { stiffness: 220, damping: 18 });
  const lean = useSpring(0, { stiffness: 220, damping: 20 });
  const hop = useSpring(0, { stiffness: 600, damping: 14 });
  useEffect(() => { if (!reduce) { rotate.set(focused ? -7 : 0); lean.set(focused ? -8 : 0); } }, [focused, reduce, rotate, lean]);
  const onPointerMove = (e: React.PointerEvent) => {
    if (reduce || focused || e.pointerType !== 'mouse' || !mascotRef.current) return;
    const r = mascotRef.current.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    rotate.set(Math.max(-6, Math.min(6, dx * 6)));
  };

  // "/" focuses the question field from anywhere on Home (not while typing in another field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role=dialog]:not([hidden]), [data-slot=sheet-content]')) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    if (reduce) { onAsk(text); return; }
    hop.set(-16);
    setTimeout(() => hop.set(0), 120);
    setTimeout(() => onAsk(text), 260);
  };

  return (
    <section
      aria-labelledby="ask-card"
      onPointerMove={onPointerMove}
      onPointerLeave={() => !focused && rotate.set(0)}
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-hero bg-gradient-to-br from-sky-from to-sky-to p-4 shadow-card @4xl:px-6 @4xl:py-5 ${className}`}
    >
      {/* Wide screens: the mascot sits inside the card on a soft glow */}
      <div ref={mascotRef} className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 @4xl:block" aria-hidden="true">
        <span className="absolute left-1/2 top-1/2 size-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-primary)_28%,transparent)_0%,transparent_70%)]" />
        <m.div style={{ rotate, x: lean, y: hop }} className="relative">
          <Mascot className="animate-float w-[140px] @6xl:w-[160px]" />
        </m.div>
      </div>

      <div className="relative flex flex-1 flex-col @4xl:justify-center @4xl:pr-[170px] @6xl:pr-[196px]">
        <div className="flex items-center gap-3">
          <MascotAvatar className="size-10 ring-2 ring-card @4xl:hidden" />
          <div className="min-w-0">
            <h1 id="ask-card" tabIndex={-1} className="text-[17px] font-semibold leading-tight tracking-tight outline-none @4xl:text-[22px]">
              <span className="@4xl:hidden">Hi {firstName}, what can I check?</span>
              <span className="hidden @4xl:inline">Hi {firstName}, what would you like to check?</span>
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-2">
              <ShieldCheck className="size-3.5 shrink-0 text-ok" aria-hidden="true" />
              Answers quote your policy wording
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-3 flex items-center gap-2 rounded-full bg-card p-1.5 pl-4 shadow-card transition-shadow focus-within:ring-2 focus-within:ring-ring @4xl:mt-4">
          <Search className="hidden size-[18px] shrink-0 text-muted-foreground @4xl:block" aria-hidden="true" />
          <label htmlFor="ask-card-input" className="sr-only">Ask about your cover</label>
          <div className="relative min-w-0 flex-1">
            {/* 16px on phones so iOS Safari doesn't zoom the page when the field is focused */}
            <Input
              ref={inputRef}
              id="ask-card-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={1500}
              autoComplete="off"
              enterKeyHint="send"
              placeholder={showTyped ? '' : 'Ask about your cover'}
              className="h-10 min-w-0 border-0 bg-transparent px-0 text-[16px] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
            />
            {showTyped && (
              <span className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center overflow-hidden whitespace-nowrap text-[16px] text-muted-foreground md:text-[15px]" aria-hidden="true">
                <span className="truncate">{typed}</span>
                <span className="caret ml-px h-[1.1em] w-px shrink-0 bg-muted-foreground" />
              </span>
            )}
          </div>
          {!q && !focused && (
            <kbd className="hidden h-6 min-w-6 shrink-0 place-items-center rounded-md border border-line bg-background px-1.5 font-sans text-[12px] font-medium text-muted-foreground @4xl:grid" aria-hidden="true">/</kbd>
          )}
          <Button type="submit" size="icon" disabled={!q.trim()} aria-label="Ask" aria-keyshortcuts="/" className={`${SEND_BUTTON} size-10`}>
            <ArrowUp className="size-5" aria-hidden="true" />
          </Button>
        </form>

        <div className="mt-3 flex items-center gap-2 @4xl:mt-4 @4xl:items-start">
          <p id="try-asking" className="shrink-0 text-[12px] font-medium text-ink-2 @4xl:pt-2.5">Try asking</p>
          {/* Phones: one swipe row that fades at the edge. Wide screens: chips wrap (short labels, at most two rows) */}
          <ul
            aria-labelledby="try-asking"
            className="no-scrollbar fade-x relative -mr-4 flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto py-1 pl-1 pr-4 @4xl:mr-0 @4xl:flex-wrap @4xl:overflow-visible @4xl:pr-0 @4xl:[-webkit-mask-image:none] @4xl:[mask-image:none]"
          >
            {chips.map((c) => (
              <li key={c.q} className="shrink-0 snap-start">
                <m.button
                  type="button"
                  onClick={() => onAsk(c.q)}
                  title={c.q}
                  data-q={c.q}
                  whileTap={{ scale: 0.96 }}
                  transition={SPRING}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-card/85 px-3 text-[13px] font-medium text-ink shadow-card transition-colors hover:bg-card"
                >
                  {c.label}
                  <ArrowUpRight className="size-3.5 text-link" aria-hidden="true" />
                </m.button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------- Needs attention ----------

const TONE_ICON: Record<AttentionTone, { icon: typeof Info; cls: string; sr: string }> = {
  bad: { icon: TriangleAlert, cls: TONE.bad, sr: 'Urgent' },
  warn: { icon: TriangleAlert, cls: TONE.warn, sr: 'Check' },
  info: { icon: Info, cls: 'bg-accent text-link', sr: 'Note' },
};

function NeedsAttention({ items, onAct, className = '' }: { items: AttentionItem[]; onAct: (i: AttentionItem) => void; className?: string }) {
  return (
    <Panel title="Needs attention" action={items.length ? <Pill tone={items.some((i) => i.tone === 'bad') ? 'bad' : 'neutral'}>{items.length}</Pill> : undefined} className={className}>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-5 pb-4">
          <span className={`grid size-9 place-items-center rounded-full ${TONE.ok}`} aria-hidden="true"><CircleCheck className="size-[18px]" /></span>
          <div>
            <p className="text-[14px] font-semibold">All clear</p>
            <p className="text-[13px] text-muted-foreground">Nothing needs your attention right now.</p>
          </div>
        </div>
      ) : (
        <m.ul variants={stagger(0.06)} className="divide-y divide-line/70 px-5 pb-2">
          {items.map((i) => {
            const t = TONE_ICON[i.tone];
            return (
              <m.li key={i.id} variants={riseSm} className="flex gap-3 py-2.5 first:pt-0.5">
                <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${t.cls}`} aria-hidden="true"><t.icon className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-snug"><span className="sr-only">{t.sr}: </span>{i.title}</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                    {i.detail}{' '}
                    <button type="button" onClick={() => onAct(i)} className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full font-semibold text-link underline-offset-2 hover:underline">
                      {i.actionLabel}<ChevronRight className="size-3.5" aria-hidden="true" />
                    </button>
                  </p>
                </div>
              </m.li>
            );
          })}
        </m.ul>
      )}
    </Panel>
  );
}

// ---------- Key figures ----------

function KeyFigures({ f, className = '' }: { f: ReturnType<typeof summaryFigures>; className?: string }) {
  const left = f.healthCoverTotal ? Math.round((f.healthCoverLeft / f.healthCoverTotal) * 100) : 0;
  const tile = `${surface} min-w-0 px-4 py-3.5`;
  return (
    <section aria-label="Key figures" className={`grid grid-cols-2 gap-3 @4xl:grid-cols-1 ${className}`}>
      <div className={`${tile} col-span-2 @4xl:col-span-1`}>
        <p className="text-[12px] font-medium text-muted-foreground">Health cover left this year</p>
        <p className="tnum mt-1 text-[22px] font-semibold leading-none tracking-tight">
          {money(f.healthCoverLeft)} <span className="text-[13px] font-medium text-muted-foreground">of {money(f.healthCoverTotal)}</span>
        </p>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${left}% of health cover left`}>
          <m.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${left}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.3 }} />
        </div>
      </div>
      <div className={tile}>
        <p className="text-[12px] font-medium text-muted-foreground">Life cover</p>
        <p className="tnum mt-1 text-[20px] font-semibold leading-none tracking-tight">{money(f.lifeCover)}</p>
      </div>
      <div className={tile}>
        <p className="text-[12px] font-medium text-muted-foreground">Claimed back</p>
        <p className="tnum mt-1 text-[20px] font-semibold leading-none tracking-tight">{fmtMoney({ currency: 'INR' }, f.claimedBack)}</p>
      </div>
    </section>
  );
}

// ---------- Who's covered ----------

/** Short column label for the coverage matrix ("Floater", "Employer", "Term life"); the full name stays available. */
function shortPolicyName(p: CoverageMatrix['policies'][number]) {
  if (p.category === 'life') return 'Term life';
  if (/employer|group|corporate/i.test(p.name)) return 'Employer';
  if (/floater/i.test(p.name)) return 'Floater';
  return p.name.split(' ')[0];
}

function WhosCovered({ mx, className = '' }: { mx: CoverageMatrix; className?: string }) {
  return (
    <Panel title="Who’s covered" className={className}>
      <div className="px-4 pb-3 @md:px-5">
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <caption className="sr-only">Who each policy covers</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[34%] pb-2 pr-2 text-[12px] font-medium text-muted-foreground">Person</th>
              {mx.policies.map((p) => (
                <th key={p.id} scope="col" className="pb-2 pr-1 text-[12px] font-medium leading-tight text-muted-foreground">
                  <abbr title={p.name} className="no-underline" aria-hidden="true">{shortPolicyName(p)}</abbr>
                  <span className="sr-only">{p.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mx.people.map((person) => (
              <tr key={person.key} className="border-b border-line/60 last:border-0">
                <th scope="row" className="py-2 pr-2 align-top font-normal">
                  <span className="block truncate text-[14px] font-semibold leading-tight">{person.name.split(' ')[0]}</span>
                  <span className="block text-[12px] text-muted-foreground">{person.relation}</span>
                </th>
                {mx.policies.map((p) => {
                  const c = mx.cells[person.key]?.[p.id];
                  return (
                    <td key={p.id} className="py-2 pr-1 align-top">
                      {c?.covered ? (
                        <span className="grid size-5 place-items-center rounded-full bg-ok-bg text-ok">
                          <Check className="size-3" strokeWidth={3} aria-hidden="true" /><span className="sr-only">Covered</span>
                        </span>
                      ) : (
                        <span className="grid h-5 items-center text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">Not covered</span></span>
                      )}
                      {c?.note && <span className="mt-0.5 block text-[11px] leading-tight text-ink-2 @md:text-[12px]">{c.note.replace(/-/g, '\u2011')}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------- Your policies (with renewals) ----------

function YourPolicies({ policies, onOpen, onAsk, onViewAll, className = '' }: { policies: Policy[]; onOpen: (p: Policy) => void; onAsk: (q?: string) => void; onViewAll: () => void; className?: string }) {
  const sorted = [...policies].sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  return (
    <Panel title="Your policies" action={viewAll(onViewAll)} className={className}>
      <ul className="px-2 pb-1">
        {sorted.map((p) => {
          const days = daysUntil(p.renewalDate);
          return (
            <li key={p.id} className="group flex items-center gap-1 rounded-card transition-colors hover:bg-muted/60">
              <button type="button" onClick={() => onOpen(p)} data-policy-id={p.id} className="focus-ring-inset flex min-w-0 flex-1 items-center gap-3 rounded-card px-3 py-3 text-left">
                <CategoryIcon c={p.category} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold leading-snug @xl:truncate">{p.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{p.provider}<span className="hidden @xl:inline"> · {categoryMeta(p.category).label}</span></span>
                  <span className="tnum block whitespace-nowrap text-[12px] text-ink-2 @xl:hidden">Renews {shortDate(p.renewalDate)} · {days} days</span>
                </span>
                <span className="tnum hidden w-[150px] shrink-0 text-[13px] text-ink-2 @xl:block">
                  Renews {shortDate(p.renewalDate)}
                  <span className="block text-[12px] text-muted-foreground">in {days} days</span>
                </span>
                <span className="tnum shrink-0 text-right text-[14px] font-semibold @xl:w-16">{fmtMoney(p, p.sumInsured, true)}</span>
              </button>
              {/* Phones: a small avatar button. Desktop: a quiet "Ask" that appears on hover or focus */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onAsk(explainPrompt(p))}
                aria-label={`Ask about ${p.name}`}
                className="mr-1 h-10 w-10 px-0 text-link hover:text-link @xl:w-auto @xl:px-3 @xl:[@media(hover:hover)]:opacity-0 @xl:[@media(hover:hover)]:group-hover:opacity-100 @xl:focus-visible:opacity-100"
              >
                <span className="grid size-8 place-items-center rounded-full bg-accent text-link @xl:hidden" aria-hidden="true"><ArrowUpRight className="size-4" /></span>
                <span className="hidden text-[13px] font-semibold @xl:inline">Ask</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------- Activity: claims and documents ----------

const CLAIM_STATUS = {
  settled: { label: 'Settled', tone: 'ok' },
  in_review: { label: 'In review', tone: 'warn' },
  closed: { label: 'Closed', tone: 'neutral' },
} as const;

function Activity({ data, onNavigate, className = '' }: { data: PortfolioData; onNavigate: (t: Tab) => void; className?: string }) {
  const rows = [
    ...data.claims.map((c) => ({ kind: 'claim' as const, date: c.date, c })),
    ...data.documents.map((d) => ({ kind: 'doc' as const, date: d.addedOn, d })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const name = (id?: string) => data.policies.find((p) => p.id === id)?.name;
  return (
    <Panel title="Activity" className={className}>
      {rows.length === 0 && <p className="px-5 pb-4 text-[14px] text-muted-foreground">No claims or documents yet.</p>}
      <ul className="grid grid-cols-1 px-2 pb-1">
        {rows.map((r) =>
          r.kind === 'claim' ? (
            <li key={r.c.id}>
              <button type="button" onClick={() => onNavigate('claims')} className="focus-ring-inset flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60">
                <span className={`grid size-9 shrink-0 place-items-center rounded-full ${TONE.ok}`} aria-hidden="true"><Receipt className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{r.c.title}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">Claim · {name(r.c.policyId)} · {formatDate(r.c.date)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tnum block text-[14px] font-semibold">{fmtMoney({ currency: 'INR' }, r.c.amountSettled ?? r.c.amountClaimed)}</span>
                  <Pill tone={CLAIM_STATUS[r.c.status].tone} className="mt-0.5">{CLAIM_STATUS[r.c.status].label}</Pill>
                </span>
              </button>
            </li>
          ) : (
            <li key={r.d.id}>
              <button type="button" onClick={() => onNavigate('documents')} className="focus-ring-inset flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60">
                <span className={`grid size-9 shrink-0 place-items-center rounded-full ${r.d.trusted ? TONE.neutral : TONE.warn}`} aria-hidden="true">
                  {r.d.trusted ? <FileText className="size-4" /> : <TriangleAlert className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{r.d.title}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{r.d.trusted ? 'Document' : 'Needs a look'} · {formatDate(r.d.addedOn)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ),
        )}
      </ul>
    </Panel>
  );
}

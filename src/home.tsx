// Home: the version 05 dashboard (sky Ask card, figures, policies, claims, documents), made quieter:
// icons only where they mean something, one strip of figures, flat lists, plain-text status.

import { useState } from 'react';
import { ArrowUp, ArrowUpRight, CalendarClock, ChevronRight, Search, TriangleAlert } from 'lucide-react';
import { m } from 'motion/react';
import type { Policy, PortfolioData } from '../shared/types';
import { coverageMatrix, summaryFigures } from '../shared/insights';
import { daysUntil, fmtDate, fmtMoney } from './format';
import { HOME_CHIPS } from './prompts';
import { Mascot, MascotAvatar, Panel, PersonAvatar, SEND_BUTTON, surface } from './ui';
import type { Tab } from './App';
import { explainPrompt } from './screens';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EASE, SPRING, rise, stagger } from './motion';

// Status as plain text; colour only where it needs attention
const CLAIM_STATUS = {
  settled: { label: 'Settled', cls: 'text-ok' },
  in_review: { label: 'In review', cls: 'text-warn' },
  closed: { label: 'Closed', cls: 'text-muted-foreground' },
} as const;
const CATEGORY_LABEL = { health: 'Health', life: 'Term life' } as Record<string, string>;
/** Lists sit flatter than the Ask card and figures: a hairline instead of a shadow */
const flat = 'border border-line/80 shadow-none dark:border-line';

const byRenewal = (a: Policy, b: Policy) => a.renewalDate.localeCompare(b.renewalDate);
const covers = (p: Policy) => {
  const nominee = p.keyFacts.find((f) => f.label === 'Nominee')?.value;
  return nominee ? `Nominee: ${nominee}` : `Covers ${p.insured.length} ${p.insured.length === 1 ? 'person' : 'people'}`;
};

const viewAll = (label: string, onClick: () => void) => (
  <Button type="button" variant="ghost" size="sm" onClick={onClick} className="-mr-2 h-10 text-[13px] font-medium text-link hover:text-link">
    {label} <ChevronRight className="size-4" aria-hidden="true" />
  </Button>
);

// ---------- Home (dashboard) ----------

export function OverviewScreen({ data, onOpenPolicy, onAsk, onNavigate }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void; onAsk: (q?: string) => void; onNavigate: (t: Tab) => void }) {
  const health = data.policies.filter((p) => p.category === 'health');
  const life = data.policies.filter((p) => p.category === 'life');
  const renewals = [...data.policies].sort(byRenewal);
  const settled = data.claims.filter((c) => c.status === 'settled');
  const money = (n: number) => fmtMoney({ currency: 'INR' }, n, true);
  const first = data.user.name.split(' ')[0];
  const people = coverageMatrix(data).people;
  const fig = summaryFigures(data);
  const leftPct = Math.round((fig.healthCoverLeft / Math.max(1, fig.healthCoverTotal)) * 100);

  return (
    <m.div initial="hidden" animate="show" variants={stagger(0.08)} className="space-y-4 pt-2 @4xl:pt-4">

      <m.div variants={rise} className="grid gap-4 @4xl:grid-cols-12">
        <AskCard firstName={first} onAsk={onAsk} className="@4xl:col-span-8" />
        <NextRenewal policy={renewals[0]} onOpen={onOpenPolicy} className="hidden @4xl:col-span-4 @4xl:flex" />
      </m.div>

      {/* Phones: four separate boxes. Wider screens: one strip whose dividers stop short of the edges. */}
      <m.section variants={rise} aria-label="Summary" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4 @4xl:gap-0 @4xl:overflow-hidden @4xl:rounded-card @4xl:bg-card @4xl:shadow-card">
        <Figure label="Health cover" value={money(fig.healthCoverTotal)} divider="right-bottom">
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${money(fig.healthCoverLeft)} of ${money(fig.healthCoverTotal)} left this year`}>
              <div className="h-full rounded-full bg-primary" style={{ width: `${leftPct}%` }} />
            </div>
            <span className="tnum shrink-0 text-[11.5px] text-muted-foreground">{money(fig.healthCoverLeft)} left</span>
          </div>
        </Figure>
        <Figure label="Term life cover" value={life.length ? money(life.reduce((s, p) => s + p.sumInsured, 0)) : '—'} divider="bottom-desk-right">
          <p className="mt-2 truncate text-[12px] text-muted-foreground max-md:text-[11.5px]">{life[0] ? covers(life[0]) : 'No term plan'}</p>
        </Figure>
        <Figure label="People covered" value={String(people.length)} divider="right">
          <div className="mt-2 flex items-center">
            <span className="flex -space-x-1.5" aria-hidden="true">
              {people.map((x) => <PersonAvatar key={x.key} name={x.name} className="size-6 ring-2 ring-card" />)}
            </span>
            <span className="ml-2 truncate text-[12px] text-muted-foreground max-md:hidden">{people.map((x) => x.name.split(' ')[0]).join(', ')}</span>
            <span className="sr-only">{people.map((x) => x.name.split(' ')[0]).join(', ')}</span>
          </div>
        </Figure>
        <Figure label="Claims settled" value={`${settled.length} of ${data.claims.length}`}>
          <p className="mt-2 truncate text-[12px] text-muted-foreground max-md:text-[11.5px]">{settled.length ? `${money(settled.reduce((s, c) => s + (c.amountSettled ?? 0), 0))} paid out` : 'None yet'}</p>
        </Figure>
      </m.section>

      <m.div variants={rise} className="grid gap-4 @4xl:grid-cols-12">
        <Panel title="Your policies" action={viewAll('View all', () => onNavigate('policies'))} className={`${flat} @4xl:col-span-8`}>
          <ul className="px-2">
            {renewals.map((p) => (
              <li key={p.id} className="group flex items-center gap-1 rounded-card transition-colors hover:bg-muted/60 active:bg-muted/80">
                <button type="button" onClick={() => onOpenPolicy(p)} data-policy-id={p.id} className="focus-ring-inset flex min-w-0 flex-1 items-center gap-3 rounded-card px-3 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] max-md:text-[13px] font-semibold" translate="no">{p.name}</span>
                    <span className="block truncate text-[12px] max-md:text-[11.5px] text-muted-foreground">{CATEGORY_LABEL[p.category]}<span className="hidden @xl:inline"> · {p.provider}</span> · Renews {fmtDate(p.renewalDate)}</span>
                  </span>
                  <span className="text-right">
                    <span className="figure block text-[15px] max-md:text-[14px]">{fmtMoney(p, p.sumInsured, true)}</span>
                    <span className="tnum hidden text-[11px] text-muted-foreground @xl:block">in {daysUntil(p.renewalDate)} days</span>
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAsk(explainPrompt(p))}
                  aria-label={`Ask about ${p.name}`}
                  className="mr-1 h-10 w-10 px-0 text-link hover:text-link @xl:w-auto @xl:px-3 @xl:text-muted-foreground @xl:group-hover:text-link"
                >
                  <ArrowUpRight className="size-4 @xl:hidden" aria-hidden="true" />
                  <span className="hidden @xl:inline">Ask</span>
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="grid gap-4 @4xl:col-span-4 @4xl:grid-rows-[auto_1fr]">
          <Panel title="Recent claims" action={viewAll('View all', () => onNavigate('claims'))} className={flat}>
            {data.claims.length === 0 && <p className="px-5 pb-4 text-[14px] text-muted-foreground">No past claims.</p>}
            <ul className="px-5">
              {data.claims.slice(0, 3).map((c) => {
                const p = data.policies.find((x) => x.id === c.policyId);
                const s = CLAIM_STATUS[c.status];
                return (
                  <li key={c.id} className="flex items-start gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] max-md:text-[13px] font-semibold">{c.title}</span>
                      <span className="block text-[12px] max-md:text-[11.5px] text-muted-foreground">{p?.name} · {fmtDate(c.date)}</span>
                    </span>
                    <span className="text-right">
                      <span className="figure block text-[15px] max-md:text-[14px]">{p ? fmtMoney(p, c.amountSettled ?? c.amountClaimed) : ''}</span>
                      <span className={`mt-0.5 block text-[12px] font-medium ${s.cls}`}>{s.label}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Documents" action={viewAll('View all', () => onNavigate('documents'))} className={flat}>
            <ul className="px-5">
              {data.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] max-md:text-[13px] font-semibold">{d.title}</span>
                    {d.trusted ? (
                      <span className="block text-[12px] max-md:text-[11.5px] text-muted-foreground">Policy document · {fmtDate(d.addedOn)}</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[12px] max-md:text-[11.5px] text-muted-foreground">
                        <TriangleAlert className="size-3.5 text-warn" fill="currentColor" fillOpacity={0.18} aria-hidden="true" />
                        <span className="font-medium text-warn">Needs review</span> · {fmtDate(d.addedOn)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </m.div>
    </m.div>
  );
}

type Divider = 'right-bottom' | 'bottom-desk-right' | 'right' | undefined;
/** One figure in the summary strip. Dividers are inset lines, not full-height borders. */
function Figure({ label, value, divider, children }: { label: string; value: string; divider?: Divider; children?: React.ReactNode }) {
  // Dividers only exist in the desktop strip; on phones each figure is its own box
  const right = divider ? 'after:hidden @4xl:after:block' : 'after:hidden';
  return (
    <div
      className={`${surface} relative min-w-0 px-4 py-3.5 after:absolute after:inset-y-4 after:right-0 after:w-px after:bg-line @4xl:rounded-none @4xl:bg-transparent @4xl:px-5 @4xl:py-4 @4xl:shadow-none ${right}`}
    >
      <p className="text-[12px] text-muted-foreground max-md:text-[11.5px]">{label}</p>
      <p className="figure mt-1 text-[24px] max-md:text-[20px]">{value}</p>
      {children}
    </div>
  );
}

/**
 * The home page's way into the assistant, on a sky card. Phones: a compact card (avatar, title, search bar and
 * one swipeable row of quick questions). Wide screens: a larger hero with the full mascot.
 */
function AskCard({ firstName, onAsk, className = '' }: { firstName: string; onAsk: (q?: string) => void; className?: string }) {
  const [q, setQ] = useState('');
  return (
    <section
      aria-labelledby="ask-card"
      className={`relative min-w-0 overflow-hidden rounded-hero bg-gradient-to-br from-sky-from to-sky-to p-4 shadow-card @4xl:px-6 @4xl:py-5 ${className}`}
    >
      <div className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 @4xl:block" aria-hidden="true">
        <span className="animate-float block" style={{ animationIterationCount: 2 }}><Mascot className="w-[140px] -scale-x-100 @6xl:w-[156px]" /></span>
      </div>
      <div className="relative @4xl:max-w-[74%]">
        <div className="flex items-center gap-3 @4xl:block">
          <MascotAvatar className="size-10 ring-2 ring-card @4xl:hidden" />
          <div className="min-w-0">
            <h1 id="ask-card" tabIndex={-1} className="text-[16px] max-md:text-[15px] font-semibold leading-tight outline-none @4xl:text-[22px] @4xl:font-medium">
              <span className="@4xl:hidden">Hi {firstName}, what can I check?</span>
              <span className="hidden @4xl:inline">Hi {firstName}, what would you like to check?</span>
            </h1>
            <p className="mt-0.5 text-[13px] max-md:text-[12px] leading-snug text-ink-2 @4xl:mt-1 @4xl:text-[13px]">
              <span className="@4xl:hidden">Answers quote your policy wording</span>
              <span className="hidden @4xl:inline">Ask about a situation or a policy — answers cite the policy wording.</span>
            </p>
          </div>
        </div>
        <form
          className="mt-3 flex items-center gap-2 rounded-full bg-card p-1.5 pl-4 shadow-card transition-shadow focus-within:ring-2 focus-within:ring-ring @4xl:mt-4 @4xl:pl-3"
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk(q.trim()); }}
        >
          <Search className="hidden size-[18px] shrink-0 text-muted-foreground @4xl:block" aria-hidden="true" />
          <label htmlFor="ask-card-input" className="sr-only">Your question</label>
          {/* 16px on phones so iOS Safari doesn't zoom the page when the field is focused */}
          <Input
            id="ask-card-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={1500}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Ask about your cover"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-[16px] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px] @4xl:h-10 @4xl:px-1 dark:bg-transparent"
          />
          <Button type="submit" size="icon" disabled={!q.trim()} aria-label="Ask" className={`${SEND_BUTTON} size-10`}>
            <ArrowUp className="size-5" aria-hidden="true" />
          </Button>
        </form>
      </div>
      {/* One row of quick questions: swipeable, fading out at the edges */}
      <ul
        className="no-scrollbar fade-x relative -mx-4 mt-3 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 @4xl:-mx-1 @4xl:mt-3 @4xl:max-w-[74%] @4xl:px-1"
        aria-label="Quick questions"
      >
        {HOME_CHIPS.map((s) => (
          <li key={s.q} className="shrink-0 snap-start">
            <m.button
              type="button"
              onClick={() => onAsk(s.q)}
              aria-label={`${s.label}: ${s.q}`}
              whileTap={{ scale: 0.95 }}
              transition={SPRING}
              className="inline-flex h-9 max-md:h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-3.5 max-md:px-3 text-[13px] max-md:text-[12px] font-medium shadow-card transition-colors hover:bg-card @4xl:h-8 @4xl:px-3 @4xl:text-[12.5px] @4xl:bg-card/80 @4xl:shadow-none"
            >
              {s.label}
            </m.button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NextRenewal({ policy: p, onOpen, className = '' }: { policy: Policy; onOpen: (p: Policy) => void; className?: string }) {
  const total = (new Date(p.renewalDate).getTime() - new Date(p.startDate).getTime()) / 86400000;
  const left = daysUntil(p.renewalDate);
  const done = Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100)));
  return (
    <Card className={`${surface} min-w-0 flex-col justify-between gap-3 px-5 py-5 ${className}`}>
      <div>
        <p className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground"><CalendarClock className="size-3.5" fill="currentColor" fillOpacity={0.15} aria-hidden="true" /> Next renewal</p>
        <p className="figure mt-2 text-[22px]">{fmtDate(p.renewalDate)}</p>
        <p className="mt-1.5 truncate text-[13px] text-ink-2" translate="no">{p.name} · {p.provider}</p>
      </div>
      <div>
        <div className="flex justify-between text-[12px] text-muted-foreground"><span>Policy year</span><span className="tnum">{left} days left</span></div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done}% of the policy year has passed`}>
          <m.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${done}%` }} transition={{ duration: 0.9, ease: EASE, delay: 0.35 }} />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpen(p)} data-policy-id={p.id} className="mt-3 h-9 w-full bg-card">View policy</Button>
      </div>
    </Card>
  );
}

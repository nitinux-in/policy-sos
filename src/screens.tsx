import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CalendarClock, ChevronRight, FileText, HeartPulse, Lock, Receipt, Search, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { Clause, Policy, PortfolioData } from '../shared/types';
import { ACTIVE_CATEGORIES, DEMO_TODAY, type ActiveCategory } from '../shared/demo';
import { CATEGORY, categoryMeta, daysUntil, fmtDate, fmtMoney } from './format';
import { CLAIM_SHORTCUTS, FEATURED } from './prompts';
import { CategoryIcon, Mascot, MascotAvatar, Panel, Pill, SEND_BUTTON, Stat, StatusPill, surface, TONE, useMediaQuery } from './ui';
import type { Tab } from './App';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { m } from 'motion/react';
import { EASE, SPRING, rise, stagger } from './motion';

const byRenewal = (a: Policy, b: Policy) => a.renewalDate.localeCompare(b.renewalDate);
const covers = (p: Policy) => {
  const nominee = p.keyFacts.find((f) => f.label === 'Nominee')?.value;
  return nominee ? `Nominee: ${nominee}` : `Covers ${p.insured.length} ${p.insured.length === 1 ? 'person' : 'people'}`;
};
export const explainPrompt = (p: Policy) => `Explain the key benefits, exclusions and conditions of my ${p.name} policy`;
const today = new Date(DEMO_TODAY + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

const viewAll = (label: string, onClick: () => void) => (
  <Button type="button" variant="ghost" size="sm" onClick={onClick} className="-mr-2 h-10 text-[13px] font-medium text-link hover:text-link">
    {label} <ChevronRight className="size-4" aria-hidden="true" />
  </Button>
);

function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="pb-5 pt-2 @4xl:pb-6 @4xl:pt-4">
      <h1 tabIndex={-1} className="text-[24px] font-semibold tracking-tight outline-none @4xl:text-[30px]">{title}</h1>
      <p className="mt-1 text-[14px] text-muted-foreground">{sub}</p>
    </header>
  );
}

// ---------- Home (dashboard) ----------

export function OverviewScreen({ data, onOpenPolicy, onAsk, onNavigate }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void; onAsk: (q?: string) => void; onNavigate: (t: Tab) => void }) {
  const health = data.policies.filter((p) => p.category === 'health');
  const life = data.policies.filter((p) => p.category === 'life');
  const renewals = [...data.policies].sort(byRenewal);
  const settled = data.claims.filter((c) => c.status === 'settled');
  const money = (n: number) => fmtMoney({ currency: 'INR' }, n, true);
  const first = data.user.name.split(' ')[0];

  return (
    <m.div initial="hidden" animate="show" variants={stagger(0.08)} className="space-y-4 pt-2 @4xl:pt-4">
      <m.header variants={rise}>
        <p className="text-[13px] text-muted-foreground">{today}</p>
        <h1 tabIndex={-1} className="mt-0.5 text-[26px] font-medium tracking-tight outline-none @4xl:text-[34px]">Hello, {first}</h1>
      </m.header>

      <m.div variants={rise} className="grid gap-4 @4xl:grid-cols-12">
        <AskCard onAsk={onAsk} className="@4xl:col-span-8" />
        <NextRenewal policy={renewals[0]} onOpen={onOpenPolicy} className="hidden @4xl:col-span-4 @4xl:flex" />
      </m.div>

      <m.section variants={stagger(0.06)} aria-label="Summary" className="grid grid-cols-2 gap-3 @4xl:grid-cols-4 @4xl:gap-4">
        <Stat icon={HeartPulse} label="Health cover" value={money(health.reduce((s, p) => s + p.sumInsured, 0))} badge={<Pill tone="ok">{health.length} plans</Pill>} sub={health.map((p) => money(p.sumInsured)).join(' + ')} />
        <Stat icon={ShieldCheck} label="Term life cover" value={life.length ? money(life.reduce((s, p) => s + p.sumInsured, 0)) : '—'} badge={life.length ? <Pill tone="ok">Active</Pill> : undefined} sub={life[0] ? covers(life[0]) : undefined} />
        <Stat icon={CalendarClock} label="Next renewal" value={`${daysUntil(renewals[0].renewalDate)} days`} sub={renewals[0].name} />
        <Stat icon={Receipt} label="Claims settled" value={`${settled.length} of ${data.claims.length}`} sub={settled.length ? `${money(settled.reduce((s, c) => s + (c.amountSettled ?? 0), 0))} paid out` : undefined} />
      </m.section>

      <m.div variants={rise} className="grid gap-4 @4xl:grid-cols-12">
        <Panel title="Your policies" action={viewAll('View all', () => onNavigate('policies'))} className="@4xl:col-span-7">
          <ul className="px-2">
            {data.policies.map((p) => (
              <li key={p.id} className="flex items-center gap-1 rounded-card transition-colors hover:bg-muted/60">
                <button type="button" onClick={() => onOpenPolicy(p)} data-policy-id={p.id} className="focus-ring-inset flex min-w-0 flex-1 items-center gap-3 rounded-card px-3 py-3 text-left">
                  <CategoryIcon c={p.category} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{p.provider} · {covers(p)}</span>
                  </span>
                  <span className="text-right">
                    <span className="tnum block text-[14px] font-semibold">{fmtMoney(p, p.sumInsured, true)}</span>
                    <span className="block text-[11px] text-muted-foreground">{categoryMeta(p.category).label}</span>
                  </span>
                </button>
                <Button type="button" variant="ghost" size="icon" onClick={() => onAsk(explainPrompt(p))} aria-label={`Ask about ${p.name}`} className="mr-1 size-10 hover:bg-accent/60">
                  <MascotAvatar className="size-8" />
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Upcoming renewals" className="@4xl:col-span-5">
          <ul className="px-2">
            {renewals.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onOpenPolicy(p)} data-policy-id={p.id} className="focus-ring-inset flex w-full items-center gap-3 rounded-card px-3 py-3 text-left transition-colors hover:bg-muted/60">
                  <span className="grid size-10 shrink-0 place-items-center rounded-card bg-muted text-center leading-none" aria-hidden="true">
                    <span>
                      <span className="block text-[14px] font-semibold">{new Date(p.renewalDate + 'T00:00:00').getDate()}</span>
                      <span className="block text-[10px] uppercase text-muted-foreground">{new Date(p.renewalDate + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}</span>
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="block text-[12px] text-muted-foreground">Renews {fmtDate(p.renewalDate)}</span>
                  </span>
                  <span className="tnum whitespace-nowrap text-[13px] font-medium text-ink-2">{daysUntil(p.renewalDate)} days</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </m.div>

      <m.div variants={rise} className="grid gap-4 @4xl:grid-cols-2">
        <Panel title="Recent claims" action={viewAll('Claims', () => onNavigate('claims'))}>
          {data.claims.length === 0 && <p className="px-5 pb-4 text-[14px] text-muted-foreground">No past claims.</p>}
          <ul className="px-5">
            {data.claims.slice(0, 3).map((c) => {
              const p = data.policies.find((x) => x.id === c.policyId);
              const s = CLAIM_STATUS[c.status];
              return (
                <li key={c.id} className="flex items-start gap-3 py-2.5">
                  <span className={`grid size-10 shrink-0 place-items-center rounded-full ${TONE.ok}`} aria-hidden="true"><Receipt size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{c.title}</span>
                    <span className="block text-[12px] text-muted-foreground">{p?.name} · {fmtDate(c.date)}</span>
                  </span>
                  <span className="text-right">
                    <span className="tnum block text-[14px] font-semibold">{p ? fmtMoney(p, c.amountSettled ?? c.amountClaimed) : ''}</span>
                    <Pill tone={s.tone} className="mt-1">{s.label}</Pill>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Documents" action={viewAll('Documents', () => onNavigate('documents'))}>
          <ul className="px-5">
            {data.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <DocIcon trusted={d.trusted} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{d.title}</span>
                  <span className="block text-[12px] text-muted-foreground">{d.trusted ? 'Policy document' : 'Needs review'} · {fmtDate(d.addedOn)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </m.div>
    </m.div>
  );
}

/**
 * The home page's way into the assistant, on a sky card. Phones: a compact card (avatar, title, search bar and
 * one swipeable row of quick questions). Wide screens: a larger hero with the full mascot.
 */
function AskCard({ onAsk, className = '' }: { onAsk: (q?: string) => void; className?: string }) {
  const [q, setQ] = useState('');
  return (
    <section
      aria-labelledby="ask-card"
      className={`relative min-w-0 overflow-hidden rounded-hero bg-gradient-to-br from-sky-from to-sky-to p-4 shadow-card @4xl:p-7 ${className}`}
    >
      <Mascot className="animate-float absolute -bottom-3 right-2 hidden w-[190px] @4xl:block @6xl:w-[220px]" />
      <div className="relative @4xl:max-w-[62%]">
        <div className="flex items-center gap-3 @4xl:block">
          <MascotAvatar className="size-10 ring-2 ring-card @4xl:hidden" />
          <div className="min-w-0">
            <h2 id="ask-card" className="text-[16px] font-semibold leading-tight tracking-tight @4xl:text-[24px] @4xl:font-medium @6xl:text-[28px]">
              <span className="@4xl:hidden">Ask Ditto Assistant</span>
              <span className="hidden @4xl:inline">What would you like to check today?</span>
            </h2>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-2 @4xl:mt-1 @4xl:text-[14px]">
              <span className="@4xl:hidden">Answers quote your policy wording</span>
              <span className="hidden @4xl:inline">Ask about a situation or a policy — answers cite the policy wording.</span>
            </p>
          </div>
        </div>
        <form
          className="mt-3 flex items-center gap-2 rounded-full bg-card p-1.5 pl-4 shadow-card transition-shadow focus-within:ring-2 focus-within:ring-ring @4xl:mt-5 @4xl:pl-2"
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) onAsk(q.trim()); }}
        >
          <MascotAvatar className="hidden size-9 @4xl:inline-grid" />
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
            className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-[16px] shadow-none placeholder:text-muted-foreground focus-visible:ring-0 md:text-[15px] @4xl:h-11 @4xl:px-1 dark:bg-transparent"
          />
          <Button type="submit" size="icon" disabled={!q.trim()} aria-label="Ask" className={`${SEND_BUTTON} size-10 @4xl:size-11`}>
            <ArrowUp className="size-5" aria-hidden="true" />
          </Button>
        </form>
      </div>
      {/* Phones: one swipeable row that runs to the card's edges and fades out there; wide screens: chips wrap */}
      <ul
        className="no-scrollbar fade-x relative -mx-4 mt-3 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 py-1 @4xl:mx-0 @4xl:mt-4 @4xl:max-w-[62%] @4xl:flex-wrap @4xl:overflow-visible @4xl:px-0 @4xl:[-webkit-mask-image:none] @4xl:[mask-image:none]"
        aria-label="Quick questions"
      >
        {FEATURED.map((s) => (
          <li key={s.q} className="shrink-0 snap-start">
            <m.button
              type="button"
              onClick={() => onAsk(s.q)}
              aria-label={`${s.title}: ${s.q}`}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.95 }}
              transition={SPRING}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-medium shadow-card transition-colors hover:bg-card @4xl:bg-card/80 @4xl:shadow-none"
            >
              <s.icon className={`size-[15px] ${s.urgent ? 'text-bad' : 'text-link'}`} aria-hidden="true" />
              {s.hint}
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
    <Card className={`${surface} min-w-0 flex-col justify-between gap-5 p-6 ${className}`}>
      <div>
        <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"><CalendarClock className="size-4" aria-hidden="true" /> Next renewal</p>
        <p className="mt-3 text-[30px] font-medium leading-none tracking-tight">{fmtDate(p.renewalDate)}</p>
        <p className="mt-2 text-[14px] text-ink-2">{p.name} · {p.provider}</p>
      </div>
      <div>
        <div className="flex justify-between text-[12px] text-muted-foreground"><span>Policy year</span><span className="tnum">{left} days left</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done}% of the policy year has passed`}>
          <m.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${done}%` }} transition={{ duration: 0.9, ease: EASE, delay: 0.35 }} />
        </div>
        <Button type="button" variant="outline" onClick={() => onOpen(p)} data-policy-id={p.id} className="mt-5 w-full bg-card">View policy</Button>
      </div>
    </Card>
  );
}

function DocIcon({ trusted }: { trusted: boolean }) {
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-full ${trusted ? TONE.neutral : TONE.warn}`} aria-hidden="true">
      {trusted ? <FileText size={17} /> : <TriangleAlert size={17} />}
    </span>
  );
}

/** Policies as a shadcn data table when the card is wide enough, as compact rows when it isn't. */
function PolicyTable({ policies, onOpen, onAsk }: { policies: Policy[]; onOpen: (p: Policy) => void; onAsk: (q?: string) => void }) {
  return (
    <>
      <div className="hidden @xl:block">
        <Table className="text-[14px]">
          <TableHeader>
            <TableRow className="border-line-2 hover:bg-transparent">
              <TableHead className="pl-5 text-[12px] font-medium text-muted-foreground">Policy</TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground">Type</TableHead>
              <TableHead className="text-right text-[12px] font-medium text-muted-foreground">Cover</TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground">Renews</TableHead>
              <TableHead className="text-[12px] font-medium text-muted-foreground">Status</TableHead>
              <TableHead className="pr-4"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {policies.map((p) => (
              <TableRow key={p.id} onClick={() => onOpen(p)} className="cursor-pointer border-line-2">
                <TableCell className="py-3 pl-5">
                  <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(p); }} data-policy-id={p.id} className="flex items-center gap-3 text-left">
                    <CategoryIcon c={p.category} size="sm" />
                    <span>
                      <span className="block font-semibold">{p.name}</span>
                      <span className="block text-[12px] text-muted-foreground">{p.provider} · {covers(p)}</span>
                    </span>
                  </button>
                </TableCell>
                <TableCell className="text-ink-2">{categoryMeta(p.category).label}</TableCell>
                <TableCell className="tnum text-right font-semibold">{fmtMoney(p, p.sumInsured, true)}</TableCell>
                <TableCell className="text-ink-2">{fmtDate(p.renewalDate)}</TableCell>
                <TableCell><StatusPill p={p} /></TableCell>
                <TableCell className="pr-4 text-right">
                  <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onAsk(explainPrompt(p)); }} aria-label={`Ask about ${p.name}`} className="h-10 pl-1.5! text-link hover:text-link">
                    <MascotAvatar className="size-7" /> Ask
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="px-2 @xl:hidden">
        {policies.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onOpen(p)} data-policy-id={p.id} className="focus-ring-inset flex w-full items-center gap-3 rounded-card px-3 py-3 text-left transition-colors hover:bg-muted/60">
              <CategoryIcon c={p.category} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{p.provider} · {covers(p)}</span>
              </span>
              <span className="text-right">
                <span className="tnum block text-[14px] font-semibold">{fmtMoney(p, p.sumInsured, true)}</span>
                <StatusPill p={p} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- Policies ----------

export function PoliciesScreen({ data, onOpenPolicy, onAsk }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void; onAsk: (q?: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ActiveCategory | 'all'>('all');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.policies.filter(
      (p) =>
        (cat === 'all' || p.category === cat) &&
        (!t || [p.name, p.provider, categoryMeta(p.category).label, p.summary, ...p.insured, ...p.clauses.map((c) => c.title)].join(' ').toLowerCase().includes(t)),
    );
  }, [q, cat, data]);
  const insurers = new Set(data.policies.map((p) => p.provider)).size;

  return (
    <div className="animate-rise">
      <PageTitle title="Policies" sub={`${data.policies.length} health and term life policies from ${insurers} insurers`} />
      <div className="mb-4 flex flex-col gap-3 @2xl:flex-row @2xl:items-center">
        <div className="relative @2xl:w-[360px]">
          <label htmlFor="policy-search" className="sr-only">Search policies</label>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="policy-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search benefits, people, clauses…"
            className="h-11 rounded-full border-0 bg-card pl-11 pr-11 text-[14px] shadow-card md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <Button type="button" variant="ghost" size="icon" onClick={() => setQ('')} className="absolute right-0.5 top-1/2 size-10 -translate-y-1/2 text-muted-foreground" aria-label="Clear search">
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <ToggleGroup type="single" value={cat} onValueChange={(v) => v && setCat(v as ActiveCategory | 'all')} aria-label="Filter by type" className="gap-1 rounded-full bg-card p-1 shadow-card">
          {(['all', ...ACTIVE_CATEGORIES] as const).map((c) => (
            <ToggleGroupItem key={c} value={c} className="h-9 rounded-full! px-4 text-[13px] font-medium data-[state=on]:bg-ink data-[state=on]:text-white dark:data-[state=on]:bg-accent dark:data-[state=on]:text-accent-foreground">
              {c === 'all' ? 'All' : CATEGORY[c].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <p className="sr-only" aria-live="polite">{list.length} {list.length === 1 ? 'policy' : 'policies'} shown</p>

      <Panel title={`${cat === 'all' ? 'All policies' : `${CATEGORY[cat].label} policies`} (${list.length})`}>
        {list.length > 0 ? (
          <PolicyTable policies={list} onOpen={onOpenPolicy} onAsk={onAsk} />
        ) : (
          <div className="px-5 py-12 text-center">
            <p className="font-semibold">No policies match{q ? ` “${q}”` : ''}</p>
            <Button type="button" variant="ghost" onClick={() => { setQ(''); setCat('all'); }} className="mt-2 text-link hover:text-link">Clear search and filters</Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Policy detail (shadcn Sheet) ----------

const TYPE_LABEL: Record<Clause['type'], string> = {
  benefit: 'Benefits',
  limit: 'Limits',
  deductible: 'Deductibles and co-pay',
  waiting_period: 'Waiting periods',
  condition: 'Conditions',
  exclusion: 'Exclusions',
  claim_process: 'How to claim',
};

export function PolicySheet({ policy: p, onClose, onAsk }: { policy: Policy | null; onClose: () => void; onAsk: (q?: string) => void }) {
  const wide = useMediaQuery('(min-width: 768px)');
  // Keep the last policy while the sheet animates closed
  const [shown, setShown] = useState<Policy | null>(p);
  if (p && p !== shown) setShown(p);
  const pol = p ?? shown;
  // The sheet opens from list rows rather than a Radix trigger, so remember the opener and return focus to it
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!p) return;
    const active = document.activeElement as HTMLElement | null;
    opener.current = active && active !== document.body ? active : null;
  }, [p]);
  const restoreFocus = (e: Event) => {
    e.preventDefault();
    const fallback = pol ? [...document.querySelectorAll<HTMLElement>(`[data-policy-id="${pol.id}"]`)].find((n) => n.offsetParent) : null;
    const target = opener.current && document.contains(opener.current) && opener.current.offsetParent ? opener.current : fallback;
    target?.focus({ preventScroll: true });
  };
  const groups = pol ? (Object.keys(TYPE_LABEL) as Clause['type'][]).map((t) => ({ t, items: pol.clauses.filter((c) => c.type === t) })).filter((g) => g.items.length) : [];
  return (
    <Sheet open={!!p} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        onCloseAutoFocus={restoreFocus}
        side={wide ? 'right' : 'bottom'}
        className={wide ? 'w-full gap-0 border-0 sm:max-w-[500px] md:m-3 md:h-[calc(100%-1.5rem)] md:rounded-hero' : 'max-h-[90dvh] gap-0 rounded-t-hero border-0'}
      >
        {pol && (
          <>
            <SheetHeader className="flex-row items-start gap-3 px-5 pb-2 pt-5 pr-14 md:px-6">
              <CategoryIcon c={pol.category} />
              <div className="min-w-0">
                <SheetTitle className="text-[19px] font-semibold tracking-tight">{pol.name}</SheetTitle>
                <SheetDescription className="text-[13px]">{pol.provider} · {pol.policyNumber}</SheetDescription>
              </div>
            </SheetHeader>
            <div className="overflow-y-auto overscroll-contain px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-3 md:px-6">
              <div className="flex flex-wrap gap-2"><StatusPill p={pol} /></div>
              <p className="mt-3 text-[14px] text-ink-2">{pol.summary}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                {pol.keyFacts.map((f) => (
                  <div key={f.label} className="rounded-tile bg-muted p-3">
                    <dt className="text-[12px] text-muted-foreground">{f.label}</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <dl className="mt-2 space-y-1.5 rounded-tile bg-muted p-3.5 text-[13px]">
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Covers</dt><dd>{pol.insured.join(', ')}</dd></div>
                <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Period</dt><dd>{fmtDate(pol.startDate)} – {fmtDate(pol.renewalDate)}</dd></div>
                {pol.claimContact && <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Claims</dt><dd>{pol.claimContact}</dd></div>}
              </dl>
              <Button type="button" onClick={() => onAsk(explainPrompt(pol))} className="mt-5 w-full">
                <MascotAvatar className="-ml-1 size-7 ring-2 ring-white/70" /> Explain this policy
              </Button>

              <h3 className="mt-8 text-[16px] font-semibold">Policy clauses</h3>
              <div className="mt-3 space-y-5">
                {groups.map((g) => (
                  <section key={g.t} aria-label={TYPE_LABEL[g.t]}>
                    <h4 className="mb-1 text-[13px] font-semibold text-muted-foreground">{TYPE_LABEL[g.t]}</h4>
                    <Accordion type="multiple" className="rounded-tile bg-muted px-3.5">
                      {g.items.map((c) => (
                        <AccordionItem key={c.id} value={c.id} className="border-line">
                          <AccordionTrigger className="min-h-12 items-center py-2.5 text-[14px] hover:no-underline">
                            <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3">
                              <span className="font-medium">{c.title}</span>
                              <span className="text-[12px] font-normal text-muted-foreground">{c.section}</span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="text-[13px] leading-relaxed text-ink-2">{c.text}</AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </section>
                ))}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Claims ----------

const CLAIM_STATUS = {
  settled: { label: 'Settled', tone: 'ok' },
  in_review: { label: 'In review', tone: 'warn' },
  closed: { label: 'Closed', tone: 'neutral' },
} as const;

export function ClaimsScreen({ data, onAsk }: { data: PortfolioData; onAsk: (q?: string) => void }) {
  const byId = Object.fromEntries(data.policies.map((p) => [p.id, p]));
  return (
    <div className="animate-rise">
      <PageTitle title="Claims" sub="Step-by-step claim help and past claims" />
      <div className="grid items-start gap-4 @4xl:grid-cols-3">
        <section aria-labelledby="start-claim" className="rounded-card bg-gradient-to-br from-sky-from to-sky-to p-5 shadow-card @4xl:order-2">
          <div className="flex items-center gap-3">
            <MascotAvatar className="size-10" />
            <h2 id="start-claim" className="text-[16px] font-semibold">Start a claim</h2>
          </div>
          <p className="mt-3 text-[14px] text-ink-2">
            Ask the assistant. It finds the right policy, quotes the claim steps from the policy wording and prepares a
            checklist. Claims are filed with your insurer directly.
          </p>
          <ul className="mt-4 space-y-2">
            {CLAIM_SHORTCUTS.map((s) => (
              <li key={s.q}>
                <button type="button" onClick={() => onAsk(s.q)} className="flex min-h-12 w-full items-center justify-between gap-2 rounded-tile bg-card px-4 py-3 text-left text-[14px] font-medium shadow-card transition-colors hover:bg-card/80">
                  {s.label}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <Panel title={`Claim history (${data.claims.length})`} className="@4xl:order-1 @4xl:col-span-2">
          {data.claims.length === 0 && <p className="px-5 pb-4 text-[14px] text-muted-foreground">No past claims.</p>}
          {data.claims.length > 0 && (
            <>
              <div className="hidden @xl:block">
                <Table className="text-[14px]">
                  <TableHeader>
                    <TableRow className="border-line-2 hover:bg-transparent">
                      <TableHead className="pl-5 text-[12px] font-medium text-muted-foreground">Claim</TableHead>
                      <TableHead className="text-[12px] font-medium text-muted-foreground">Date</TableHead>
                      <TableHead className="text-right text-[12px] font-medium text-muted-foreground">Claimed</TableHead>
                      <TableHead className="text-right text-[12px] font-medium text-muted-foreground">Settled</TableHead>
                      <TableHead className="pr-5 text-[12px] font-medium text-muted-foreground">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.claims.map((c) => {
                      const p = byId[c.policyId];
                      const s = CLAIM_STATUS[c.status];
                      return (
                        <TableRow key={c.id} className="border-line-2">
                          <TableCell className="py-3 pl-5">
                            <span className="block font-semibold">{c.title}</span>
                            <span className="block text-[12px] text-muted-foreground">{p?.name} · {c.id}</span>
                          </TableCell>
                          <TableCell className="text-ink-2">{fmtDate(c.date)}</TableCell>
                          <TableCell className="tnum text-right">{p ? fmtMoney(p, c.amountClaimed) : c.amountClaimed}</TableCell>
                          <TableCell className="tnum text-right font-semibold">{c.amountSettled != null && p ? fmtMoney(p, c.amountSettled) : '—'}</TableCell>
                          <TableCell className="pr-5"><Pill tone={s.tone}>{s.label}</Pill></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <ul className="px-5 @xl:hidden">
                {data.claims.map((c) => {
                  const p = byId[c.policyId];
                  const s = CLAIM_STATUS[c.status];
                  return (
                    <li key={c.id} className="py-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[14px] font-semibold">{c.title}</h3>
                          <p className="text-[12px] text-muted-foreground">{p?.name} · {fmtDate(c.date)}</p>
                        </div>
                        <Pill tone={s.tone}>{s.label}</Pill>
                      </div>
                      <dl className="tnum mt-2 flex gap-8 text-[13px]">
                        <div><dt className="text-[12px] text-muted-foreground">Claimed</dt><dd className="font-semibold">{p ? fmtMoney(p, c.amountClaimed) : c.amountClaimed}</dd></div>
                        {c.amountSettled != null && p && <div><dt className="text-[12px] text-muted-foreground">Settled</dt><dd className="font-semibold">{fmtMoney(p, c.amountSettled)}</dd></div>}
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ---------- Documents ----------

export function DocumentsScreen({ data }: { data: PortfolioData }) {
  const byId = Object.fromEntries(data.policies.map((p) => [p.id, p]));
  return (
    <div className="animate-rise">
      <PageTitle title="Documents" sub="Policy wordings and your uploads" />
      <Panel title={`All documents (${data.documents.length})`}>
        <Accordion type="multiple" className="px-2">
          {data.documents.map((d) => (
            <AccordionItem key={d.id} value={d.id} className="border-line-2">
              <AccordionTrigger className="min-h-16 items-center gap-3 rounded-tile px-3 py-3 hover:bg-muted/60 hover:no-underline">
                <span className="flex flex-1 items-center gap-3">
                  <DocIcon trusted={d.trusted} />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold">{d.title}</span>
                    <span className="block text-[12px] font-normal text-muted-foreground">
                      {d.policyId && byId[d.policyId]?.name} · Added {fmtDate(d.addedOn)}
                      {!d.trusted && ' · Untrusted upload'}
                    </span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 sm:pl-[64px]">
                {!d.trusted && (
                  <p className="mb-3 flex items-start gap-2 rounded-tile bg-warn-bg p-3 text-[13px] font-medium text-warn">
                    <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    Untrusted upload. The assistant treats this as plain text, ignores any instructions inside it and never uses it as policy evidence.
                  </p>
                )}
                <p className="text-[13px] leading-relaxed text-ink-2">{d.text}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Panel>
    </div>
  );
}

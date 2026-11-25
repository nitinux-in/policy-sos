import { useId, useMemo, useState, type ReactNode } from 'react';
import { CalendarClock, ChevronRight, FileText, Lock, MessageCircleQuestion, Search, TriangleAlert, X } from 'lucide-react';
import type { Clause, Policy, PortfolioData } from '../shared/types';
import { ACTIVE_CATEGORIES, type ActiveCategory } from '../shared/demo';
import { CATEGORY, categoryMeta, daysUntil, fmtDate, fmtMoney } from './lib';
import { OVERVIEW_QUESTIONS, CLAIM_SHORTCUTS } from './prompts';
import { btn, card, CategoryIcon, CloseButton, Disclosure, Modal, Pill, SampleBadge, StatusPill } from './ui';

const insurer = (p: Policy) => p.provider.replace(' (simulated)', '');
const firstName = (d: PortfolioData) => d.user.name.split(' ')[0];

function PageHeader({ title, sub, eyebrow }: { title: string; sub?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 md:mb-8">
      {eyebrow && <p className="text-[14px] text-ink-3">{eyebrow}</p>}
      <h1 tabIndex={-1} className="mt-1 text-[28px] font-bold outline-none md:text-[34px]">{title}</h1>
      {sub && <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2">{sub}</p>}
    </header>
  );
}

// ---------- Overview ----------

export function OverviewScreen({ data, onOpenPolicy, onAsk }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void; onAsk: (q?: string) => void }) {
  const insurers = new Set(data.policies.map((p) => p.provider)).size;
  const next = [...data.policies].sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))[0];

  return (
    <div className="animate-in">
      <PageHeader
        eyebrow={`Hello, ${firstName(data)}`}
        title="Your health and term life cover"
        sub={`${data.policies.length} sample policies from ${insurers} insurers, in one place. Ask about any of them and get answers backed by the policy wording.`}
      />

      <section aria-labelledby="cover-heading">
        <h2 id="cover-heading" className="sr-only">Your cover</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {ACTIVE_CATEGORIES.map((c) => (
            <CoverGroup key={c} category={c} policies={data.policies.filter((p) => p.category === c)} onOpenPolicy={onOpenPolicy} />
          ))}
        </div>
      </section>

      {next && (
        <section aria-labelledby="renewal-heading" className="mt-4">
          <h2 id="renewal-heading" className="sr-only">Next renewal</h2>
          <button type="button" onClick={() => onOpenPolicy(next)} className={`${card} flex w-full items-center gap-3 p-4 text-left transition-colors hover:border-ink-3/40`}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-line-2 text-ink-2" aria-hidden="true"><CalendarClock size={20} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink-3">Next renewal</span>
              <span className="block font-semibold">{next.name}</span>
              <span className="block text-[14px] text-ink-2">{fmtDate(next.renewalDate)} · in {daysUntil(next.renewalDate)} days</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden="true" />
          </button>
        </section>
      )}

      <section aria-labelledby="ask-heading" className="mt-8 rounded-3xl bg-sun p-5 sm:p-7">
        <h2 id="ask-heading" className="text-[21px] font-bold">Questions about your cover?</h2>
        <p className="mt-1 max-w-[56ch] text-[15px] text-sun-ink">
          Check a situation, compare your plans or get claim steps. Every answer shows the clause that supports it.
        </p>
        <ul className="mt-4 grid gap-2 md:grid-cols-3">
          {OVERVIEW_QUESTIONS.map((q) => (
            <li key={q} className="flex">
              <button type="button" onClick={() => onAsk(q)} className="flex w-full items-start gap-2 rounded-xl bg-surface p-3.5 text-left text-[14px] font-medium shadow-card transition-colors hover:bg-page">
                <MessageCircleQuestion size={17} className="mt-0.5 shrink-0 text-link" aria-hidden="true" />
                {q}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onAsk()} className={`${btn.primary} mt-4`}>
          Ask your own question
        </button>
      </section>
    </div>
  );
}

function CoverGroup({ category, policies, onOpenPolicy }: { category: ActiveCategory; policies: Policy[]; onOpenPolicy: (p: Policy) => void }) {
  const meta = CATEGORY[category];
  const headingId = useId();
  if (!policies.length) return null;
  const summary =
    category === 'life'
      ? `${fmtMoney(policies[0], policies.reduce((s, p) => s + p.sumInsured, 0), true)} life cover`
      : `${policies.length} ${policies.length === 1 ? 'plan' : 'plans'}`;
  return (
    <section aria-labelledby={headingId} className={`${card} p-4 sm:p-5`}>
      <div className="flex items-center gap-3">
        <CategoryIcon c={category} />
        <div>
          <h3 id={headingId} className="text-[17px] font-semibold">{meta.label}</h3>
          <p className="text-[14px] text-ink-3">{summary}</p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-line-2 border-t border-line-2">
        {policies.map((p) => {
          const nominee = p.keyFacts.find((f) => f.label === 'Nominee')?.value;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => onOpenPolicy(p)} data-policy-id={p.id} className="focus-ring-inset -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-3.5 text-left transition-colors hover:bg-page">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-[13px] text-ink-3">
                    {insurer(p)} · {nominee ? `Nominee: ${nominee}` : `Covers ${p.insured.length} ${p.insured.length === 1 ? 'person' : 'people'}`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tnum block font-semibold">{fmtMoney(p, p.sumInsured, true)}</span>
                  <span className="block text-[12px] text-ink-3">{meta.coverLabel}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {category === 'health' && policies.length > 1 && (
        <p className="mt-3 text-[13px] text-ink-3">Each plan has its own sum insured and covers different people.</p>
      )}
      {category === 'life' && policies.map((p) => p.keyFacts.find((f) => f.label === 'Riders')).filter(Boolean).map((f) => (
        <p key={f!.value} className="mt-3 text-[13px] text-ink-3">Rider: {f!.value}</p>
      ))}
    </section>
  );
}

// ---------- Policies ----------

export function PoliciesScreen({ data, onOpenPolicy }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void }) {
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
    <div className="animate-in">
      <PageHeader title="My policies" sub={`${data.policies.length} sample health and term life policies from ${insurers} insurers.`} />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-[380px]">
          <label htmlFor="policy-search" className="sr-only">Search policies</label>
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input
            id="policy-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search benefits, people, clauses…"
            className="min-h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-11 text-[15px] placeholder:text-ink-3 focus-visible:border-primary [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-ink-3 hover:text-ink" aria-label="Clear search">
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </div>
        <div role="group" aria-label="Filter by type" className="flex gap-2">
          {(['all', ...ACTIVE_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className="min-h-11 rounded-full border border-line bg-surface px-4 text-[14px] font-medium text-ink-2 transition-colors hover:border-ink-3/40 aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-ink"
            >
              {c === 'all' ? 'All' : CATEGORY[c].label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{list.length} {list.length === 1 ? 'policy' : 'policies'} shown</p>
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {list.map((p) => (
          <li key={p.id} className="flex"><PolicyCard p={p} onOpen={onOpenPolicy} /></li>
        ))}
      </ul>
      {list.length === 0 && (
        <div className="py-14 text-center">
          <p className="font-semibold">No policies match{q ? ` “${q}”` : ''}</p>
          <button type="button" onClick={() => { setQ(''); setCat('all'); }} className={`${btn.quiet} mt-2`}>Clear search and filters</button>
        </div>
      )}
    </div>
  );
}

function PolicyCard({ p, onOpen }: { p: Policy; onOpen: (p: Policy) => void }) {
  const meta = categoryMeta(p.category);
  return (
    <button type="button" onClick={() => onOpen(p)} data-policy-id={p.id} className={`${card} flex w-full flex-col p-4 text-left transition-colors hover:border-ink-3/40 sm:p-5`}>
      <span className="flex w-full items-start gap-3">
        <CategoryIcon c={p.category} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink-3">{meta.label}</span>
          <span className="block text-[17px] font-semibold leading-snug">{p.name}</span>
          <span className="block text-[14px] text-ink-3">{insurer(p)}</span>
        </span>
        <StatusPill p={p} />
      </span>
      <span className="mt-4 grid w-full grid-cols-2 gap-3 border-t border-line-2 pt-3">
        <span>
          <span className="block text-[13px] text-ink-3">{meta.coverLabel}</span>
          <span className="tnum block text-[16px] font-semibold">{fmtMoney(p, p.sumInsured, true)}</span>
        </span>
        <span>
          <span className="block text-[13px] text-ink-3">Renews</span>
          <span className="block text-[16px] font-semibold">{fmtDate(p.renewalDate)}</span>
        </span>
      </span>
    </button>
  );
}

// ---------- Policy detail ----------

const TYPE_LABEL: Record<Clause['type'], string> = {
  benefit: 'Benefits',
  limit: 'Limits',
  deductible: 'Deductibles and co-pay',
  waiting_period: 'Waiting periods',
  condition: 'Conditions',
  exclusion: 'Exclusions',
  claim_process: 'How to claim',
};

export function PolicySheet({ policy: p, onClose, onAsk }: { policy: Policy; onClose: () => void; onAsk: (q?: string) => void }) {
  const groups = (Object.keys(TYPE_LABEL) as Clause['type'][]).map((t) => ({ t, items: p.clauses.filter((c) => c.type === t) })).filter((g) => g.items.length);
  return (
    <Modal labelledBy="policy-title" onClose={onClose} returnSelector={`[data-policy-id="${p.id}"]`}>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4 md:px-6">
        <CategoryIcon c={p.category} />
        <div className="min-w-0 flex-1">
          <h2 id="policy-title" className="text-[20px] font-bold">{p.name}</h2>
          <p className="text-[14px] text-ink-3">{p.provider} · {p.policyNumber}</p>
        </div>
        <CloseButton onClick={onClose} label="Close policy details" />
      </div>
      <div className="overflow-y-auto overscroll-contain px-5 pb-[max(env(safe-area-inset-bottom),24px)] pt-5 md:px-6">
        <div className="flex flex-wrap gap-2"><StatusPill p={p} /><SampleBadge label="Sample policy" /></div>
        <p className="mt-3 text-ink-2">{p.summary}</p>
        <dl className="mt-4 grid grid-cols-2 gap-2">
          {p.keyFacts.map((f) => (
            <div key={f.label} className="rounded-xl bg-page p-3">
              <dt className="text-[13px] text-ink-3">{f.label}</dt>
              <dd className="mt-0.5 font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-3 space-y-1.5 rounded-xl border border-line p-3.5 text-[14px]">
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-3">Covers</dt><dd>{p.insured.join(', ')}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-3">Period</dt><dd>{fmtDate(p.startDate)} – {fmtDate(p.renewalDate)}</dd></div>
          {p.claimContact && <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-3">Claims</dt><dd>{p.claimContact}</dd></div>}
        </dl>
        <button type="button" onClick={() => onAsk(`Explain the key benefits, exclusions and conditions of my ${p.name} policy`)} className={`${btn.primary} mt-5 w-full`}>
          <MessageCircleQuestion size={18} aria-hidden="true" /> Explain this policy
        </button>

        <h3 className="mt-8 text-[17px] font-semibold">Policy clauses</h3>
        <p className="text-[13px] text-ink-3">From the sample policy wording.</p>
        <div className="mt-3 space-y-5">
          {groups.map((g) => (
            <section key={g.t} aria-label={TYPE_LABEL[g.t]}>
              <h4 className="mb-2 text-[14px] font-semibold text-ink-2">{TYPE_LABEL[g.t]}</h4>
              <ul className="space-y-2">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <Disclosure
                      className="rounded-xl border border-line"
                      buttonClassName="min-h-12 rounded-xl px-3.5 py-2.5"
                      summary={
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-[14px] font-medium">{c.title}</span>
                          <span className="text-[13px] text-ink-3">{c.section}</span>
                        </span>
                      }
                    >
                      <p className="border-t border-line-2 px-3.5 py-3 text-[14px] leading-relaxed text-ink-2">{c.text}</p>
                    </Disclosure>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Claims ----------

const CLAIM_STATUS = {
  settled: { label: 'Settled', cls: 'bg-ok-bg text-ok' },
  in_review: { label: 'In review', cls: 'bg-warn-bg text-warn' },
  closed: { label: 'Closed', cls: 'bg-line-2 text-ink-2' },
} as const;

export function ClaimsScreen({ data, onAsk }: { data: PortfolioData; onAsk: (q?: string) => void }) {
  const byId = Object.fromEntries(data.policies.map((p) => [p.id, p]));
  return (
    <div className="animate-in">
      <PageHeader title="Claims" sub="Get step-by-step help for a health or term life claim, and see past claims." />
      <section aria-labelledby="new-claim" className={`${card} p-5`}>
        <h2 id="new-claim" className="text-[18px] font-semibold">Starting a claim?</h2>
        <p className="mt-1 max-w-[62ch] text-[15px] text-ink-2">
          Ask the companion. It finds the right policy, quotes the claim steps from the policy wording and prepares a
          checklist. Claims are filed with your insurer directly — this concept can’t submit them.
        </p>
        <ul className="mt-4 grid gap-2 md:grid-cols-3">
          {CLAIM_SHORTCUTS.map((s) => (
            <li key={s.q} className="flex">
              <button type="button" onClick={() => onAsk(s.q)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-4 py-3 text-left text-[14px] font-medium transition-colors hover:border-primary hover:bg-primary-tint">
                {s.label}
                <ChevronRight size={17} className="shrink-0 text-ink-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="claim-history" className="mt-8">
        <h2 id="claim-history" className="mb-3 text-[18px] font-semibold">Claim history</h2>
        {data.claims.length === 0 && <p className="text-ink-3">No past claims in the sample data.</p>}
        <ul className="space-y-3">
          {data.claims.map((c) => {
            const p = byId[c.policyId];
            const s = CLAIM_STATUS[c.status];
            return (
              <li key={c.id} className={`${card} p-4 sm:p-5`}>
                <div className="flex items-start gap-3">
                  {p && <CategoryIcon c={p.category} />}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{c.title}</h3>
                    <p className="text-[13px] text-ink-3">{p?.name} · {fmtDate(c.date)} · {c.id}</p>
                  </div>
                  <Pill className={s.cls}>{s.label}</Pill>
                </div>
                <dl className="tnum mt-3 flex gap-8 border-t border-line-2 pt-3 text-[14px]">
                  <div><dt className="text-[13px] text-ink-3">Claimed</dt><dd className="font-semibold">{p ? fmtMoney(p, c.amountClaimed) : c.amountClaimed}</dd></div>
                  {c.amountSettled != null && p && <div><dt className="text-[13px] text-ink-3">Settled</dt><dd className="font-semibold">{fmtMoney(p, c.amountSettled)}</dd></div>}
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// ---------- Documents ----------

export function DocumentsScreen({ data }: { data: PortfolioData }) {
  const byId = Object.fromEntries(data.policies.map((p) => [p.id, p]));
  return (
    <div className="animate-in">
      <PageHeader title="Documents" sub="Policy wordings and your uploads. These are sample records — there is no real file upload in this concept." />
      <ul className="space-y-3">
        {data.documents.map((d) => (
          <li key={d.id}>
            <Disclosure
              className={card}
              buttonClassName="min-h-16 rounded-2xl p-4"
              summary={
                <span className="flex items-center gap-3">
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${d.trusted ? 'bg-line-2 text-ink-2' : 'bg-warn-bg text-warn'}`} aria-hidden="true">
                    {d.trusted ? <FileText size={20} /> : <TriangleAlert size={20} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{d.title}</span>
                    <span className="block text-[13px] text-ink-3">
                      {d.policyId && byId[d.policyId]?.name} · Added {fmtDate(d.addedOn)}
                      {!d.trusted && ' · Untrusted upload'}
                    </span>
                  </span>
                </span>
              }
            >
              <div className="border-t border-line-2 p-4">
                {!d.trusted && (
                  <p className="mb-3 flex items-start gap-2 rounded-xl bg-warn-bg p-3 text-[13px] font-medium text-warn">
                    <Lock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Untrusted upload. The companion treats this as plain text, ignores any instructions inside it and never uses it as policy evidence.
                  </p>
                )}
                <p className="text-[14px] leading-relaxed text-ink-2">{d.text}</p>
              </div>
            </Disclosure>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Lock, Search, Sparkles, X } from 'lucide-react';
import type { Category, Clause, Policy, PortfolioData } from '../shared/types';
import { CATEGORY, daysUntil, fmtDate, fmtMoney } from './lib';
import type { Tab } from './App';

// ---------- shared bits ----------

export function SimBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-3">
      Simulated data
    </span>
  );
}

function ScreenHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="px-5 pb-3 pt-[max(env(safe-area-inset-top),20px)]">
      <div className="flex items-center justify-between pt-3">
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        <SimBadge />
      </div>
      {sub && <p className="mt-1 text-[13.5px] text-ink-2">{sub}</p>}
    </header>
  );
}

function CategoryIcon({ c, size = 18 }: { c: Category; size?: number }) {
  const m = CATEGORY[c];
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${m.tint}`}>
      <m.icon size={size} strokeWidth={1.9} />
    </span>
  );
}

function StatusPill({ p }: { p: Policy }) {
  const d = daysUntil(p.renewalDate);
  if (p.status === 'expiring_soon' || d <= 30)
    return <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">Expires in {d}d</span>;
  if (p.status === 'lapsed') return <span className="rounded-full bg-bad-bg px-2 py-0.5 text-[11px] font-medium text-bad">Lapsed</span>;
  return <span className="rounded-full bg-ok-bg px-2 py-0.5 text-[11px] font-medium text-ok">Active</span>;
}

export function PolicyCard({ p, onOpen }: { p: Policy; onOpen: (p: Policy) => void }) {
  return (
    <button onClick={() => onOpen(p)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left active:bg-line-2">
      <CategoryIcon c={p.category} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14.5px] font-semibold">{p.name}</p>
        </div>
        <p className="truncate text-[12.5px] text-ink-3">{p.provider.replace(' (simulated)', '')}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <p className="tnum text-[14px] font-semibold">{fmtMoney(p, p.sumInsured, true)}</p>
        <StatusPill p={p} />
      </div>
    </button>
  );
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <button className="absolute inset-0 bg-ink/30" onClick={onClose} aria-label="Close" />
      <div className="animate-sheet relative flex max-h-[88%] flex-col rounded-t-[28px] bg-canvas">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3">
          <div className="min-w-0">{title}</div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-line-2 text-ink-2" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="no-scrollbar overflow-y-auto px-5 pb-8">{children}</div>
      </div>
    </div>
  );
}

// ---------- Overview ----------

const QUICK_ASKS = [
  'My car windshield cracked. Can I claim it?',
  "I'm travelling to Japan next month. What should I check?",
  'Compare my health policies',
];

export function OverviewScreen({ data, onOpenPolicy, onAsk, onTab }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void; onAsk: (q?: string) => void; onTab: (t: Tab) => void }) {
  const inr = data.policies.filter((p) => p.currency === 'INR');
  const totalCover = inr.reduce((s, p) => s + p.sumInsured, 0);
  const annualPremium = inr.reduce((s, p) => s + p.premium, 0);
  const insurers = new Set(data.policies.map((p) => p.provider)).size;
  const renewals = [...data.policies].filter((p) => daysUntil(p.renewalDate) <= 60).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  const cats = Object.keys(CATEGORY) as Category[];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="animate-in">
      <header className="px-5 pt-[max(env(safe-area-inset-top),20px)]">
        <div className="flex items-center justify-between pt-3">
          <div>
            <p className="text-[13px] text-ink-3">{greet}</p>
            <h1 className="text-[24px] font-semibold tracking-tight">{data.user.name.split(' ')[0]}</h1>
          </div>
          <SimBadge />
        </div>
      </header>

      {/* Portfolio summary */}
      <section className="mx-5 mt-4 rounded-3xl bg-ink p-5 text-white">
        <p className="text-[12.5px] text-white/60">Total cover across your portfolio</p>
        <p className="tnum mt-1 text-[32px] font-semibold tracking-tight">{fmtMoney({ currency: 'INR' }, totalCover, true)}</p>
        <p className="mt-0.5 text-[12.5px] text-white/60">+ US$100,000 travel medical</p>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-[12px]">
          <div><p className="text-white/50">Policies</p><p className="tnum mt-0.5 text-[16px] font-semibold">{data.policies.length}</p></div>
          <div><p className="text-white/50">Insurers</p><p className="tnum mt-0.5 text-[16px] font-semibold">{insurers}</p></div>
          <div><p className="text-white/50">Premium / yr</p><p className="tnum mt-0.5 text-[16px] font-semibold">{fmtMoney({ currency: 'INR' }, annualPremium, true)}</p></div>
        </div>
      </section>

      {/* Coverage overview */}
      <section className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5">
        {cats.map((c) => {
          const has = data.policies.some((p) => p.category === c);
          const M = CATEGORY[c];
          return (
            <button key={c} onClick={() => onTab('policies')} className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium">
              <M.icon size={14} className={has ? 'text-ink' : 'text-ink-3'} />
              {M.label}
              <span className={`h-1.5 w-1.5 rounded-full ${has ? 'bg-ok' : 'bg-line'}`} />
            </button>
          );
        })}
      </section>

      {/* Needs attention */}
      {renewals.length > 0 && (
        <section className="mx-5 mt-5">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Needs attention</h2>
          {renewals.slice(0, 2).map((p) => (
            <div key={p.id} className="mb-2 rounded-2xl border border-warn/20 bg-warn-bg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" />
                <div className="flex-1">
                  <p className="text-[14px] font-semibold">{p.name} expires {fmtDate(p.renewalDate)}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-2">
                    {p.category === 'travel' ? "Trips after this date won't be covered." : 'Renew on time to avoid a gap in cover.'} {daysUntil(p.renewalDate)} days left.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => onAsk(p.category === 'travel' ? "I'm travelling to Japan next month. What should I check?" : `My ${p.name} policy renews on ${p.renewalDate}. What should I review before renewing?`)}
                      className="rounded-full bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white"
                    >
                      {p.category === 'travel' ? 'Check my trip' : 'Review before renewal'}
                    </button>
                    <button onClick={() => onOpenPolicy(p)} className="rounded-full border border-ink/15 px-3 py-1.5 text-[12.5px] font-medium">View policy</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Ask */}
      <section className="mx-5 mt-5 rounded-2xl border border-violet/15 bg-violet-2/60 p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-violet" />
          <p className="text-[14px] font-semibold">Ask about any situation</p>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-2">Policy SOS checks the fine print across all your policies.</p>
        <div className="mt-3 space-y-1.5">
          {QUICK_ASKS.map((q) => (
            <button key={q} onClick={() => onAsk(q)} className="flex w-full items-center justify-between rounded-xl bg-surface px-3 py-2.5 text-left text-[13px] font-medium active:bg-line-2">
              {q} <ChevronRight size={15} className="shrink-0 text-ink-3" />
            </button>
          ))}
        </div>
      </section>

      {/* Policies */}
      <section className="mx-5 mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Your policies</h2>
          <button onClick={() => onTab('policies')} className="text-[12.5px] font-medium text-violet">See all</button>
        </div>
        <div className="space-y-2">
          {data.policies.slice(0, 4).map((p) => <PolicyCard key={p.id} p={p} onOpen={onOpenPolicy} />)}
        </div>
      </section>
      <p className="mx-5 mt-6 text-[11px] leading-relaxed text-ink-3">{data.disclaimer}</p>
    </div>
  );
}

// ---------- Policies ----------

export function PoliciesScreen({ data, onOpenPolicy }: { data: PortfolioData; onOpenPolicy: (p: Policy) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.policies.filter(
      (p) =>
        (cat === 'all' || p.category === cat) &&
        (!t || [p.name, p.provider, p.category, p.summary, ...p.insured, ...p.clauses.map((c) => c.title)].join(' ').toLowerCase().includes(t)),
    );
  }, [q, cat, data]);
  const cats = (Object.keys(CATEGORY) as Category[]).filter((c) => data.policies.some((p) => p.category === c));

  return (
    <div className="animate-in">
      <ScreenHeader title="My policies" sub={`${data.policies.length} policies from ${new Set(data.policies.map((p) => p.provider)).size} insurers, in one place`} />
      <div className="px-5">
        <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
          <Search size={16} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policies, benefits, people…" className="w-full bg-transparent text-[14px] outline-none placeholder:text-ink-3" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search"><X size={15} className="text-ink-3" /></button>}
        </label>
      </div>
      <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-5">
        {(['all', ...cats] as const).map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium ${cat === c ? 'bg-ink text-white' : 'border border-line bg-surface text-ink-2'}`}>
            {c === 'all' ? 'All' : CATEGORY[c].label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-2 px-5">
        {list.map((p) => <PolicyCard key={p.id} p={p} onOpen={onOpenPolicy} />)}
        {list.length === 0 && <p className="py-10 text-center text-[13.5px] text-ink-3">No policies match “{q}”.</p>}
      </div>
    </div>
  );
}

// ---------- Policy detail ----------

const TYPE_LABEL: Record<Clause['type'], string> = {
  benefit: 'Benefits',
  limit: 'Limits',
  deductible: 'Deductibles & co-pay',
  waiting_period: 'Waiting periods',
  condition: 'Conditions',
  exclusion: 'Exclusions',
  claim_process: 'How to claim',
};

export function PolicySheet({ policy: p, onClose, onAsk }: { policy: Policy; onClose: () => void; onAsk: (q?: string) => void }) {
  const groups = (Object.keys(TYPE_LABEL) as Clause['type'][]).map((t) => ({ t, items: p.clauses.filter((c) => c.type === t) })).filter((g) => g.items.length);
  return (
    <Sheet
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <CategoryIcon c={p.category} />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold">{p.name}</p>
            <p className="truncate text-[12.5px] text-ink-3">{p.provider} · {p.policyNumber}</p>
          </div>
        </div>
      }
    >
      <p className="text-[13.5px] text-ink-2">{p.summary}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {p.keyFacts.map((f) => (
          <div key={f.label} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-[11.5px] text-ink-3">{f.label}</p>
            <p className="mt-0.5 text-[13.5px] font-semibold">{f.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-[12.5px]">
        <p><span className="text-ink-3">Covers: </span>{p.insured.join(', ')}</p>
        <p className="mt-1"><span className="text-ink-3">Period: </span>{fmtDate(p.startDate)} – {fmtDate(p.renewalDate)}</p>
      </div>
      <button onClick={() => onAsk(`Explain the key benefits, exclusions and conditions of my ${p.name} policy`)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-violet py-3 text-[14px] font-semibold text-white">
        <Sparkles size={16} /> Explain this policy
      </button>
      <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Policy clauses</h3>
      <div className="mt-2 space-y-4">
        {groups.map((g) => (
          <div key={g.t}>
            <p className="mb-1.5 text-[13px] font-semibold">{TYPE_LABEL[g.t]}</p>
            <div className="space-y-1.5">{g.items.map((c) => <ClauseRow key={c.id} c={c} />)}</div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function ClauseRow({ c }: { c: Clause }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
        <span className="text-[13px] font-medium">{c.title}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">{c.section}<ChevronDown size={14} className={open ? 'rotate-180' : ''} /></span>
      </button>
      {open && <p className="border-t border-line-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">{c.text}</p>}
    </div>
  );
}

// ---------- Claims ----------

export function ClaimsScreen({ data, onAsk }: { data: PortfolioData; onAsk: (q?: string) => void }) {
  const byId = Object.fromEntries(data.policies.map((p) => [p.id, p]));
  const statusStyle = { settled: 'bg-ok-bg text-ok', in_review: 'bg-warn-bg text-warn', closed: 'bg-line-2 text-ink-2' } as const;
  return (
    <div className="animate-in">
      <ScreenHeader title="Claims" sub="Track past claims and get step-by-step help with new ones." />
      <section className="mx-5 rounded-2xl border border-line bg-surface p-4">
        <p className="text-[14px] font-semibold">Starting a new claim?</p>
        <p className="mt-0.5 text-[12.5px] text-ink-2">Tell the assistant what happened. It will find the right policy, check conditions and prepare a checklist. Claims are filed with your insurer directly.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {['My car was damaged in an accident', 'My laptop was stolen from home', 'My baggage was delayed abroad'].map((q) => (
            <button key={q} onClick={() => onAsk(`${q}. Can I claim, and what are the steps?`)} className="rounded-full border border-line px-3 py-1.5 text-[12.5px] font-medium active:bg-line-2">{q}</button>
          ))}
        </div>
      </section>
      <h2 className="mx-5 mb-2 mt-6 text-[13px] font-semibold uppercase tracking-wide text-ink-3">History</h2>
      <div className="space-y-2 px-5">
        {data.claims.map((c) => {
          const p = byId[c.policyId];
          return (
            <div key={c.id} className="rounded-2xl border border-line bg-surface p-3.5">
              <div className="flex items-start gap-3">
                {p && <CategoryIcon c={p.category} />}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold">{c.title}</p>
                  <p className="text-[12px] text-ink-3">{p?.name} · {fmtDate(c.date)} · {c.id}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle[c.status]}`}>{c.status.replace('_', ' ')}</span>
              </div>
              <div className="tnum mt-3 flex gap-6 border-t border-line-2 pt-2.5 text-[12.5px]">
                <p><span className="text-ink-3">Claimed </span>{p ? fmtMoney(p, c.amountClaimed) : c.amountClaimed}</p>
                {c.amountSettled != null && p && <p><span className="text-ink-3">Settled </span>{fmtMoney(p, c.amountSettled)}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Documents ----------

export function DocumentsScreen({ data }: { data: PortfolioData }) {
  const [open, setOpen] = useState<string | null>(null);
  const byId = Object.fromEntries(data.policies.map((p) => [p.id, p]));
  return (
    <div className="animate-in">
      <ScreenHeader title="Documents" sub="Policy wordings, schedules and your uploads." />
      <div className="space-y-2 px-5">
        {data.documents.map((d) => (
          <div key={d.id} className="rounded-2xl border border-line bg-surface">
            <button onClick={() => setOpen(open === d.id ? null : d.id)} className="flex w-full items-center gap-3 p-3.5 text-left">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${d.trusted ? 'bg-line-2 text-ink-2' : 'bg-warn-bg text-warn'}`}>
                {d.trusted ? <FileText size={18} /> : <AlertTriangle size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{d.title}</p>
                <p className="text-[12px] text-ink-3">{d.policyId && byId[d.policyId]?.name} · {fmtDate(d.addedOn)}</p>
              </div>
              <ChevronDown size={16} className={`text-ink-3 ${open === d.id ? 'rotate-180' : ''}`} />
            </button>
            {open === d.id && (
              <div className="border-t border-line-2 p-3.5">
                {!d.trusted && (
                  <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium text-warn">
                    <Lock size={12} /> Untrusted upload — the assistant treats this as text only and ignores any instructions inside it.
                  </p>
                )}
                <p className="text-[12.5px] leading-relaxed text-ink-2">{d.text}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

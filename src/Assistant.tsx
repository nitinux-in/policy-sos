import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  ArrowUp, Calculator, Check, CircleCheck, CircleHelp, CircleX, FileSearch, ListChecks, LoaderCircle,
  MessageCircleQuestion, OctagonAlert, RotateCcw, ShieldAlert, Table2,
} from 'lucide-react';
import type { AgentAnswer, AgentStep, CoverageStatus, PortfolioData } from '../shared/types';
import { askAgent } from './lib';
import { FEATURED } from './prompts';
import { btn, CloseButton, Disclosure, Pill, useOverlay } from './ui';

export const ASSISTANT_PANEL_ID = 'companion-panel';

type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; answer: AgentAnswer }
  | { id: number; role: 'error'; text: string; retry: string };

let nextId = 1;

export function Assistant({ data, initialPrompt, docked, onClose }: { data: PortfolioData; initialPrompt?: string; docked: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const reqId = useRef(0);
  const first = data.user.name.split(' ')[0];

  // Docked beside the dashboard on wide screens (non-modal); a full-screen dialog otherwise
  useOverlay(panelRef, onClose, !docked, '[data-ask-trigger]');

  // Cancel any in-flight request when the panel closes
  useEffect(() => () => { reqId.current++; abortRef.current?.abort(); }, []);

  // Ask the prefilled question once (timer makes this safe under React's dev double-mount)
  useEffect(() => {
    if (!initialPrompt) return;
    const t = setTimeout(() => send(initialPrompt), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While working: follow the live steps. When an answer arrives: show it from its first line.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant') {
      const q = el.querySelector<HTMLElement>('[data-last-question]');
      if (q) { el.scrollTo({ top: q.offsetTop - 12, behavior: smooth }); return; }
    }
    el.scrollTo({ top: el.scrollHeight, behavior: smooth });
  }, [msgs, liveSteps, busy]);

  const lastUserId = [...msgs].reverse().find((m) => m.role === 'user')?.id;
  // The untrusted-document note is shown once per conversation, not on every answer
  const untrustedNoteId = msgs.find((m) => m.role === 'assistant' && m.answer.untrustedNotice)?.id;
  const last = msgs[msgs.length - 1];
  const status = busy ? 'Checking your sample policies…' : last?.role === 'assistant' ? 'Answer ready.' : last?.role === 'error' ? 'That didn’t go through.' : '';

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (q.length > 1500) {
      setMsgs((m) => [...m, { id: nextId++, role: 'error', text: 'That message is too long. Please keep it under 1,500 characters.', retry: '' }]);
      return;
    }
    setMsgs((m) => [...m, { id: nextId++, role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    setLiveSteps([]);
    const ac = new AbortController();
    abortRef.current = ac;
    const my = ++reqId.current;
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const answer = await askAgent(q, (s) => my === reqId.current && setLiveSteps((prev) => [...prev, s]), ac.signal);
      if (my !== reqId.current) return; // conversation was reset
      setMsgs((m) => [...m, { id: nextId++, role: 'assistant', answer }]);
    } catch (e) {
      if (my !== reqId.current) return;
      const msg = (e as Error).name === 'AbortError' ? 'This took too long and was stopped.' : (e as Error).message || 'Network error.';
      setMsgs((m) => [...m, { id: nextId++, role: 'error', text: msg, retry: q }]);
    } finally {
      clearTimeout(timer);
      if (my === reqId.current) {
        setBusy(false);
        setLiveSteps([]);
      }
    }
  }

  function reset() {
    reqId.current++;
    abortRef.current?.abort();
    setMsgs([]);
    setInput('');
    setBusy(false);
    setLiveSteps([]);
  }

  return (
    <section
      ref={panelRef}
      id={ASSISTANT_PANEL_ID}
      role={docked ? 'region' : 'dialog'}
      aria-modal={docked ? undefined : true}
      aria-labelledby="companion-title"
      tabIndex={-1}
      className={`flex flex-col bg-surface outline-none ${
        docked ? 'animate-drawer fixed bottom-0 right-0 top-16 z-20 w-[440px] border-l border-line' : 'animate-sheet fixed inset-0 z-50'
      }`}
    >
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line py-2 pl-4 pr-2 pt-[max(env(safe-area-inset-top),8px)]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white" aria-hidden="true"><MessageCircleQuestion size={19} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="companion-title" className="truncate text-[16px] font-semibold tracking-tight">Ask about your cover</h2>
          <p className="truncate text-[12px] text-ink-3">Concept demo · {data.policies.length} sample health and term life policies</p>
        </div>
        {msgs.length > 0 && (
          <button type="button" onClick={reset} aria-label="Start a new chat" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-line-2">
            <RotateCcw size={15} aria-hidden="true" /> <span className="hidden sm:inline">New chat</span>
          </button>
        )}
        <CloseButton onClick={onClose} label="Close the companion" />
      </header>

      {/* Conversation */}
      <div ref={scrollRef} className="@container relative flex-1 space-y-4 overflow-y-auto overscroll-contain bg-page px-4 py-5">
        {msgs.length === 0 && !busy && (
          <div className="animate-in">
            <p className="text-[14px] text-ink-3">Hi {first}</p>
            <h3 className="mt-1 text-[24px] font-bold">What would you like to check?</h3>
            <p className="mt-2 text-[15px] text-ink-2">Answers come from your sample health and term life policies, with the clause that supports them.</p>
            <ul className="mt-5 grid grid-cols-2 gap-3">
              {FEATURED.map((s) => (
                <li key={s.q} className="flex">
                  <button
                    type="button"
                    onClick={() => send(s.q)}
                    aria-label={`${s.title}: ${s.q}`}
                    className="flex min-h-[136px] w-full flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-primary"
                  >
                    <span className={`grid h-10 w-10 place-items-center rounded-full ${s.urgent ? 'bg-bad-bg text-bad' : 'bg-primary-tint text-link'}`} aria-hidden="true">
                      <s.icon size={19} />
                    </span>
                    <span>
                      <span className="block text-[15px] font-semibold">{s.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{s.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end" {...(m.id === lastUserId ? { 'data-last-question': '' } : {})}>
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-bubble px-4 py-2.5 text-[15px] text-bubble-ink">{m.text}</p>
            </div>
          ) : m.role === 'error' ? (
            <div key={m.id} className="rounded-2xl border border-bad/25 bg-bad-bg p-4 text-[14px]" role="alert">
              <p className="font-semibold text-bad">That didn’t go through</p>
              <p className="mt-0.5 text-ink-2">{m.text}</p>
              {m.retry && <button type="button" onClick={() => send(m.retry)} className={`${btn.secondary} mt-3`}>Try again</button>}
            </div>
          ) : (
            <AnswerView key={m.id} a={m.answer} onAsk={send} busy={busy} showUntrusted={m.id === untrustedNoteId} />
          ),
        )}

        {busy && <LiveActivity steps={liveSteps} />}
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t border-line bg-surface px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3"
      >
        <label htmlFor="companion-input" className="sr-only">Your question</label>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-4 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <textarea
            id="companion-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            maxLength={1500}
            placeholder="Ask about a situation or a policy…"
            className="max-h-28 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-[15px] placeholder:text-ink-3 focus-visible:outline-none"
          />
          <button type="submit" disabled={!input.trim() || busy} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-white transition-colors hover:bg-primary-strong disabled:bg-line disabled:text-ink-3" aria-label="Send question">
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={19} aria-hidden="true" />}
          </button>
        </div>
        <p className="mt-2 text-center text-[12px] leading-snug text-ink-3">
          Concept demo · answers come from local rules over sample policy data, not a live AI. Your insurer makes the final call.
        </p>
      </form>
    </section>
  );
}

// ---------- live activity (real local tool steps as they run) ----------

function LiveActivity({ steps }: { steps: AgentStep[] }) {
  return (
    <div className="animate-in rounded-2xl border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <LoaderCircle size={16} className="animate-spin text-primary" aria-hidden="true" /> Checking your sample policies
      </p>
      <ul className="mt-2 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px]">
            {s.ok ? <Check size={15} className="mt-0.5 shrink-0 text-ok" aria-hidden="true" /> : <CircleX size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />}
            <span><span className="font-medium">{s.label}</span>{s.detail && <span className="text-ink-3"> — {s.detail}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- answer ----------

const STATUS: Record<CoverageStatus, { cls: string; icon: typeof CircleCheck; label: string }> = {
  Supported: { cls: 'bg-ok-bg text-ok', icon: CircleCheck, label: 'Supported' },
  Uncertain: { cls: 'bg-warn-bg text-warn', icon: CircleHelp, label: 'Uncertain' },
  'Not found': { cls: 'bg-line-2 text-ink-2', icon: CircleX, label: 'Not found' },
};

const block = 'rounded-2xl border border-line bg-surface p-4';

function AnswerView({ a, onAsk, busy, showUntrusted }: { a: AgentAnswer; onAsk: (q: string) => void; busy: boolean; showUntrusted: boolean }) {
  const coverage = a.coverage.some((c) => c.status !== 'Not found') ? a.coverage.filter((c) => c.status !== 'Not found') : a.coverage;
  return (
    <article className="animate-in space-y-3" aria-label="Answer">
      {a.safetyNotice && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-urgent p-4 text-[15px] font-semibold text-white" role="alert">
          <OctagonAlert size={20} className="shrink-0" aria-hidden="true" />
          <p>{a.safetyNotice}</p>
        </div>
      )}

      <div className={block}>
        <div className="md text-[15px] leading-relaxed text-ink-2">
          <ReactMarkdown>{a.text}</ReactMarkdown>
        </div>
        {a.suggestions && a.suggestions.length > 0 && (
          <ul className="mt-3 space-y-2">
            {a.suggestions.map((q) => (
              <li key={q}>
                <button type="button" onClick={() => onAsk(q)} disabled={busy} className="w-full rounded-xl border border-line px-3.5 py-2.5 text-left text-[14px] font-medium text-ink transition-colors hover:border-primary hover:bg-primary-tint disabled:text-ink-3">
                  {q}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {coverage.map((c) => {
        const S = STATUS[c.status];
        return (
          <section key={c.policyId} className={block} aria-label={`Coverage under ${c.policyName}`}>
            <div className="flex items-start justify-between gap-3">
              <h4 className="font-semibold">{c.policyName}</h4>
              <Pill className={`${S.cls} font-semibold`}><S.icon size={14} aria-hidden="true" />{S.label}</Pill>
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{c.reasoning}</p>
            {c.unknowns.length > 0 && (
              <Disclosure className="mt-2" buttonClassName="min-h-11 rounded-lg" summary={<span className="flex items-center gap-1.5 text-[14px] font-medium text-ink-2"><CircleHelp size={15} className="text-ink-3" aria-hidden="true" />What isn’t verified ({c.unknowns.length})</span>}>
                <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">{c.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>
              </Disclosure>
            )}
          </section>
        );
      })}

      {a.cost?.map((c) => (
        <section key={c.policyId} className={block} aria-label={`Cost estimate for ${c.policyName}`}>
          <h4 className="flex items-center gap-2 font-semibold"><Calculator size={17} className="text-link" aria-hidden="true" /> Cost estimate · {c.policyName}</h4>
          {c.sufficientData ? (
            <>
              <div className="tnum mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-primary-tint p-3"><p className="text-[13px] text-primary-ink">You may pay</p><p className="text-[20px] font-bold text-primary-ink">{c.currency}{(c.estimatedOutOfPocket ?? 0).toLocaleString('en-IN')}</p></div>
                <div className="rounded-xl bg-page p-3"><p className="text-[13px] text-ink-3">Insurer may pay</p><p className="text-[20px] font-bold">{c.currency}{(c.estimatedInsurerShare ?? 0).toLocaleString('en-IN')}</p></div>
              </div>
              <dl className="tnum mt-3 space-y-1.5 text-[14px]">
                {c.inputs.map((i) => <div key={i.label} className="flex justify-between gap-3"><dt className="text-ink-3">{i.label}</dt><dd>{i.value}</dd></div>)}
                {c.lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-ink-3">{l.label}</dt><dd className="whitespace-nowrap">− {c.currency}{l.amount.toLocaleString('en-IN')}</dd></div>)}
              </dl>
            </>
          ) : (
            <p className="mt-1.5 text-[14px] text-ink-2">Not enough information for an estimate yet. Needed: <span className="font-medium text-ink">{c.missing.join('; ')}</span>.</p>
          )}
          {c.assumptions.length > 0 && (
            <Disclosure className="mt-2" buttonClassName="min-h-11 rounded-lg" summary={<span className="text-[14px] font-medium text-ink-2">{c.sufficientData ? 'Assumptions' : 'What the policy already tells us'}</span>}>
              <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">{c.assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
            </Disclosure>
          )}
        </section>
      ))}

      {a.comparison && <ComparisonView c={a.comparison} />}

      {a.plan && <PlanCard plan={a.plan} />}

      {a.evidence.length > 0 && (
        <Disclosure
          className={`${block} py-1`}
          buttonClassName="min-h-12 rounded-xl"
          summary={<span className="flex items-center gap-2 text-[14px] font-semibold"><FileSearch size={17} className="text-ink-3" aria-hidden="true" />Policy evidence · {a.evidence.length} {a.evidence.length === 1 ? 'clause' : 'clauses'}</span>}
        >
          <ul className="space-y-3 pb-3 pt-1">
            {a.evidence.map((e) => (
              <li key={e.clauseId} className="rounded-xl bg-page p-3.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold">
                  {e.title}
                  <span className="text-[13px] font-normal text-ink-3">{e.section}</span>
                  <Pill className="bg-surface text-ink-3">{e.type.replace('_', ' ')}</Pill>
                </p>
                <blockquote className="mt-1.5 border-l-2 border-line pl-3 text-[14px] leading-relaxed text-ink">{e.text}</blockquote>
                <p className="mt-1.5 text-[12px] text-ink-3">Source: {e.source}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {showUntrusted && a.untrustedNotice && (
        <p className="flex gap-2 rounded-2xl border border-warn/20 bg-warn-bg p-3.5 text-[13px] text-ink-2">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />{a.untrustedNotice}
        </p>
      )}

      {a.steps.length > 0 && (
        <Disclosure buttonClassName="min-h-11 rounded-lg px-1" summary={<span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-3"><ListChecks size={15} aria-hidden="true" />How this answer was built · {a.steps.length} local {a.steps.length === 1 ? 'step' : 'steps'}</span>}>
          <ol className="space-y-1 px-1 pb-1 text-[13px]">
            {a.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="tnum text-ink-3">{i + 1}.</span>
                <span><span className="font-medium">{s.label}</span> <code className="rounded bg-line-2 px-1 text-[12px] text-ink-3">{s.tool}</code>{s.detail && <span className="text-ink-3"> — {s.detail}</span>}</span>
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
    </article>
  );
}

function ComparisonView({ c }: { c: NonNullable<AgentAnswer['comparison']> }) {
  const name = (id: string) => c.policies.find((x) => x.policyId === id)?.policyName ?? id;
  const notSpecified = (v: string) => v.startsWith('Not specified');
  return (
    <section className={block} aria-label="Policy comparison">
      <h4 className="flex items-center gap-2 font-semibold"><Table2 size={17} className="text-link" aria-hidden="true" /> Side by side</h4>

      {/* Wide containers: a real table */}
      <div className="mt-3 hidden overflow-x-auto @lg:block">
        <table className="w-full border-collapse text-left text-[14px]">
          <caption className="sr-only">Comparison of {c.policies.map((p) => p.policyName).join(' and ')}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[22%] py-2 pr-3 text-[13px] font-semibold text-ink-3">Criterion</th>
              {c.policies.map((p) => <th key={p.policyId} scope="col" className="py-2 pr-3 text-[13px] font-semibold">{p.policyName}</th>)}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.criterion} className="border-b border-line-2 align-top last:border-0">
                <th scope="row" className="py-2.5 pr-3 text-[13px] font-semibold text-ink-2">{r.criterion}</th>
                {r.values.map((v) => <td key={v.policyId} className={`py-2.5 pr-3 leading-snug ${notSpecified(v.value) ? 'italic text-ink-3' : ''}`}>{v.value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow containers: stacked rows */}
      <dl className="mt-3 space-y-3 @lg:hidden">
        {c.rows.map((r) => (
          <div key={r.criterion} className="border-t border-line-2 pt-3 first:border-0 first:pt-0">
            <dt className="text-[13px] font-semibold text-ink-3">{r.criterion}</dt>
            {r.values.map((v) => (
              <dd key={v.policyId} className="mt-1.5">
                <span className="block text-[12px] font-medium text-ink-3">{name(v.policyId)}</span>
                <span className={`block text-[14px] leading-snug ${notSpecified(v.value) ? 'italic text-ink-3' : ''}`}>{v.value}</span>
              </dd>
            ))}
          </div>
        ))}
      </dl>
      {c.notes.map((n) => <p key={n} className="mt-3 text-[13px] text-ink-3">{n}</p>)}
    </section>
  );
}

function PlanCard({ plan }: { plan: NonNullable<AgentAnswer['plan']> }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const headingId = useId();
  return (
    <section className={`rounded-2xl border bg-surface p-4 ${plan.urgent ? 'border-bad/30' : 'border-line'}`} aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3">
        <h4 id={headingId} className="flex items-center gap-2 font-semibold"><ListChecks size={17} className={plan.urgent ? 'text-bad' : 'text-link'} aria-hidden="true" /> {plan.title}</h4>
        <span className="tnum text-[13px] text-ink-3">{done.size} of {plan.steps.length} done</span>
      </div>
      <ul className="mt-2 space-y-1">
        {plan.steps.map((s, i) => {
          const on = done.has(i);
          return (
            <li key={i}>
              <label className="flex cursor-pointer gap-3 rounded-xl p-2 hover:bg-page">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setDone((d) => { const n = new Set(d); if (on) n.delete(i); else n.add(i); return n; })}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className={`block text-[14px] font-medium ${on ? 'text-ink-3 line-through' : ''}`}>{s.text}</span>
                  {s.detail && <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{s.detail}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

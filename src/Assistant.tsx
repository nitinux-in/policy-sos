import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AlertOctagon, ArrowUp, Calculator, Check, CheckCircle2, ChevronDown, CircleHelp, FileSearch, ListChecks,
  Loader2, RotateCcw, ShieldAlert, Sparkles, Table2, X, XCircle,
} from 'lucide-react';
import type { AgentAnswer, AgentStep, ChatTurn, CoverageStatus, PortfolioData } from '../shared/types';
import { askAgent } from './lib';

type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; answer: AgentAnswer }
  | { id: number; role: 'error'; text: string; retry: string };

const SUGGESTIONS: { group: string; q: string }[] = [
  { group: 'Check a claim', q: 'My car windshield cracked yesterday. Can I claim this, and will I have to pay anything?' },
  { group: 'Plan', q: "I'm travelling to Japan next month. What should I check?" },
  { group: 'Compare', q: 'Compare my health policies' },
  { group: 'Emergency', q: 'My father has been admitted after a cardiac emergency. Which policy can help, and what should I do?' },
  { group: 'Explain', q: 'Is dental treatment covered by any of my policies?' },
];

let nextId = 1;

export function Assistant({ data, initialPrompt, onClose }: { data: PortfolioData; initialPrompt?: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setAiOn(!!h.ai)).catch(() => setAiOn(false));
  }, []);

  // Cancel any in-flight request when the panel closes
  useEffect(() => () => { reqId.current++; abortRef.current?.abort(); }, []);

  // Ask the prefilled question once (timer makes this safe under React's dev double-mount)
  useEffect(() => {
    if (!initialPrompt) return;
    const t = setTimeout(() => send(initialPrompt), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, liveSteps, busy]);

  function history(): ChatTurn[] {
    return msgs.flatMap((m): ChatTurn[] =>
      m.role === 'user' ? [{ role: 'user', text: m.text }] : m.role === 'assistant' ? [{ role: 'assistant', text: m.answer.text }] : [],
    );
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (q.length > 1500) {
      setMsgs((m) => [...m, { id: nextId++, role: 'error', text: 'That message is too long. Please keep it under 1,500 characters.', retry: '' }]);
      return;
    }
    const hist = history();
    setMsgs((m) => [...m, { id: nextId++, role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    setLiveSteps([]);
    const ac = new AbortController();
    abortRef.current = ac;
    const my = ++reqId.current;
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const answer = await askAgent(q, hist, (s) => my === reqId.current && setLiveSteps((prev) => [...prev, s]), ac.signal);
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
    <div className="animate-sheet absolute inset-0 z-40 flex flex-col bg-canvas">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-[max(env(safe-area-inset-top),16px)]">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet text-white"><Sparkles size={18} /></span>
        <div className="flex-1">
          <p className="text-[15px] font-semibold leading-tight">Policy SOS</p>
          <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
            <span className={`h-1.5 w-1.5 rounded-full ${aiOn ? 'bg-ok' : aiOn === false ? 'bg-warn' : 'bg-line'}`} />
            {aiOn ? 'AI agent · reads your 7 policies' : aiOn === false ? 'Offline demo mode · rule-based planner' : 'Connecting…'}
          </p>
        </div>
        {msgs.length > 0 && (
          <button onClick={reset} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-2" aria-label="Start a new conversation">
            <RotateCcw size={13} /> New
          </button>
        )}
        <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-line-2 text-ink-2" aria-label="Close assistant"><X size={16} /></button>
      </header>

      {/* Conversation */}
      <div ref={scrollRef} className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && !busy && (
          <div className="animate-in">
            <p className="text-[20px] font-semibold tracking-tight">Hi {data.user.name.split(' ')[0]}, what's going on?</p>
            <p className="mt-1 text-[13.5px] text-ink-2">
              Ask about any situation. I'll search your {data.policies.length} policies, check the actual clauses, and tell you what's covered, what's unclear, and what to do next.
            </p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button key={s.q} onClick={() => send(s.q)} className="w-full rounded-2xl border border-line bg-surface p-3 text-left active:bg-line-2">
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${s.group === 'Emergency' ? 'text-bad' : 'text-violet'}`}>{s.group}</p>
                  <p className="mt-0.5 text-[13.5px] font-medium">{s.q}</p>
                </button>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-ink-3">Uses simulated policy data. Not legal or financial advice; your insurer makes the final claim decision.</p>
          </div>
        )}

        {msgs.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] text-white">{m.text}</p>
            </div>
          ) : m.role === 'error' ? (
            <div key={m.id} className="rounded-2xl border border-bad/20 bg-bad-bg p-3.5 text-[13px]">
              <p className="font-semibold text-bad">Couldn't get an answer</p>
              <p className="mt-0.5 text-ink-2">{m.text}</p>
              {m.retry && <button onClick={() => send(m.retry)} className="mt-2 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white">Try again</button>}
            </div>
          ) : (
            <AnswerView key={m.id} a={m.answer} />
          ),
        )}

        {busy && <LiveActivity steps={liveSteps} />}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="border-t border-line bg-canvas px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-3.5 focus-within:border-violet/50">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            maxLength={1500}
            placeholder="Describe your situation…"
            className="max-h-28 flex-1 resize-none bg-transparent py-2 text-[14.5px] outline-none placeholder:text-ink-3"
            aria-label="Message"
          />
          <button type="submit" disabled={!input.trim() || busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet text-white disabled:bg-line disabled:text-ink-3" aria-label="Send">
            {busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- live activity ----------

function LiveActivity({ steps }: { steps: AgentStep[] }) {
  return (
    <div className="animate-in rounded-2xl border border-line bg-surface p-3.5">
      <p className="flex items-center gap-2 text-[13px] font-semibold"><Loader2 size={15} className="animate-spin text-violet" /> Working on it</p>
      <ul className="mt-2 space-y-1.5">
        {steps.length === 0 && <li className="text-[12.5px] text-ink-3">Understanding your question…</li>}
        {steps.map((s, i) => (
          <li key={i} className="animate-in flex items-start gap-2 text-[12.5px]">
            {s.ok ? <Check size={14} className="mt-0.5 text-ok" /> : <XCircle size={14} className="mt-0.5 text-warn" />}
            <span><span className="font-medium">{s.label}</span>{s.detail && <span className="text-ink-3"> — {s.detail}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- answer ----------

const STATUS: Record<CoverageStatus, { cls: string; icon: typeof CheckCircle2; label: string }> = {
  Supported: { cls: 'bg-ok-bg text-ok', icon: CheckCircle2, label: 'Supported by policy' },
  Uncertain: { cls: 'bg-warn-bg text-warn', icon: CircleHelp, label: 'Uncertain' },
  'Not found': { cls: 'bg-line-2 text-ink-2', icon: XCircle, label: 'Not found in policy' },
};

function AnswerView({ a }: { a: AgentAnswer }) {
  return (
    <div className="animate-in space-y-2.5">
      {a.safetyNotice && (
        <div className={`flex gap-2.5 rounded-2xl p-3.5 text-[13px] ${a.safetyNotice.startsWith('If someone') ? 'bg-bad text-white' : 'border border-warn/20 bg-warn-bg text-ink'}`}>
          {a.safetyNotice.startsWith('If someone') ? <AlertOctagon size={18} className="shrink-0" /> : <ShieldAlert size={18} className="shrink-0 text-warn" />}
          <p className="font-medium">{a.safetyNotice}</p>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-3.5">
        {a.mode === 'demo' && (
          <p className="mb-2 inline-flex rounded-full bg-warn-bg px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-warn" title={a.modeNote}>Offline demo mode · not AI</p>
        )}
        <div className="md text-[14px] leading-relaxed text-ink-2">
          <ReactMarkdown>{a.text}</ReactMarkdown>
        </div>
        {a.mode === 'demo' && a.modeNote && <p className="mt-2 text-[11px] text-ink-3">{a.modeNote}</p>}
      </div>

      {a.coverage.map((c) => {
        const S = STATUS[c.status];
        return (
          <div key={c.policyId} className="rounded-2xl border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13.5px] font-semibold">{c.policyName}</p>
              <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${S.cls}`}><S.icon size={13} />{c.status}</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{c.reasoning}</p>
            {c.unknowns.length > 0 && (
              <Expander label={`What's not verified (${c.unknowns.length})`} icon={CircleHelp}>
                <ul className="space-y-1 text-[12.5px] text-ink-2">{c.unknowns.map((u) => <li key={u}>• {u}</li>)}</ul>
              </Expander>
            )}
          </div>
        );
      })}

      {a.cost?.map((c) => (
        <div key={c.policyId} className="rounded-2xl border border-line bg-surface p-3.5">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Calculator size={15} className="text-violet" /> Cost estimate · {c.policyName}</p>
          {c.sufficientData ? (
            <>
              <div className="tnum mt-2.5 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-violet-2 p-2.5"><p className="text-[11px] text-violet-ink">You may pay</p><p className="text-[18px] font-semibold text-violet-ink">{c.currency}{(c.estimatedOutOfPocket ?? 0).toLocaleString('en-IN')}</p></div>
                <div className="rounded-xl bg-line-2 p-2.5"><p className="text-[11px] text-ink-3">Insurer may pay</p><p className="text-[18px] font-semibold">{c.currency}{(c.estimatedInsurerShare ?? 0).toLocaleString('en-IN')}</p></div>
              </div>
              <ul className="tnum mt-2.5 space-y-1 text-[12.5px]">
                {c.inputs.map((i) => <li key={i.label} className="flex justify-between"><span className="text-ink-3">{i.label}</span><span>{i.value}</span></li>)}
                {c.lines.map((l) => <li key={l.label} className="flex justify-between"><span className="text-ink-3">{l.label}</span><span>− {c.currency}{l.amount.toLocaleString('en-IN')}</span></li>)}
              </ul>
            </>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-ink-2">Not enough information for an estimate yet. Needed: <span className="font-medium text-ink">{c.missing.join('; ')}</span>.</p>
          )}
          {c.assumptions.length > 0 && (
            <Expander label={c.sufficientData ? 'Assumptions' : 'What the policy already tells us'} icon={CircleHelp}>
              <ul className="space-y-1 text-[12.5px] text-ink-2">{c.assumptions.map((x) => <li key={x}>• {x}</li>)}</ul>
            </Expander>
          )}
        </div>
      ))}

      {a.comparison && (
        <div className="rounded-2xl border border-line bg-surface p-3.5">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Table2 size={15} className="text-violet" /> Side-by-side</p>
          <div className="mt-2.5 space-y-2.5">
            {a.comparison.rows.map((r) => (
              <div key={r.criterion} className="border-t border-line-2 pt-2.5 first:border-0 first:pt-0">
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{r.criterion}</p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {r.values.map((v) => {
                    const pol = a.comparison!.policies.find((x) => x.policyId === v.policyId);
                    return (
                      <div key={v.policyId}>
                        <p className="text-[10.5px] text-ink-3">{pol?.policyName}</p>
                        <p className={`text-[12.5px] leading-snug ${v.value.startsWith('Not specified') ? 'italic text-ink-3' : ''}`}>{v.value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {a.comparison.notes.map((n) => <p key={n} className="mt-2.5 text-[11.5px] text-ink-3">{n}</p>)}
        </div>
      )}

      {a.plan && <PlanCard plan={a.plan} />}

      {a.evidence.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface p-3.5">
          <p className="flex items-center gap-2 text-[13.5px] font-semibold"><FileSearch size={15} className="text-violet" /> Policy evidence ({a.evidence.length})</p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">Exact clauses retrieved from your (simulated) policy data.</p>
          <div className="mt-2 space-y-1.5">
            {a.evidence.map((e) => (
              <Expander key={e.clauseId} label={`${e.title} · ${e.section}`} tag={e.type.replace('_', ' ')} boxed>
                <p className="text-[12.5px] leading-relaxed text-ink">“{e.text}”</p>
                <p className="mt-1.5 text-[11px] text-ink-3">Source: {e.source}</p>
              </Expander>
            ))}
          </div>
        </div>
      )}

      {a.steps.length > 0 && (
        <Expander label={`How I worked this out · ${a.steps.length} steps`} icon={ListChecks}>
          <ol className="space-y-1 text-[12.5px]">
            {a.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="tnum text-ink-3">{i + 1}.</span>
                <span><span className="font-medium">{s.label}</span> <code className="rounded bg-line-2 px-1 text-[10.5px] text-ink-3">{s.tool}</code>{s.detail && <span className="text-ink-3"> — {s.detail}</span>}</span>
              </li>
            ))}
          </ol>
        </Expander>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: NonNullable<AgentAnswer['plan']> }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  return (
    <div className={`rounded-2xl border p-3.5 ${plan.urgent ? 'border-bad/25 bg-surface' : 'border-line bg-surface'}`}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold"><ListChecks size={15} className={plan.urgent ? 'text-bad' : 'text-violet'} /> {plan.title}</p>
        <span className="tnum text-[11.5px] text-ink-3">{done.size}/{plan.steps.length}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {plan.steps.map((s, i) => {
          const on = done.has(i);
          return (
            <li key={i}>
              <button
                onClick={() => setDone((d) => { const n = new Set(d); if (on) n.delete(i); else n.add(i); return n; })}
                className="flex w-full gap-2.5 rounded-lg p-1.5 text-left active:bg-line-2"
                aria-pressed={on}
              >
                <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border ${on ? 'border-violet bg-violet text-white' : 'border-ink/20'}`}>{on && <Check size={12} />}</span>
                <span>
                  <span className={`block text-[13px] font-medium ${on ? 'text-ink-3 line-through' : ''}`}>{s.text}</span>
                  {s.detail && <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{s.detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Expander({ label, children, icon: Icon, tag, boxed }: { label: string; children: React.ReactNode; icon?: typeof ListChecks; tag?: string; boxed?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={boxed ? 'rounded-xl border border-line-2 bg-canvas' : 'mt-2'}>
      <button onClick={() => setOpen(!open)} className={`flex w-full items-center justify-between gap-2 text-left ${boxed ? 'px-3 py-2' : 'py-1'}`} aria-expanded={open}>
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
          {Icon && <Icon size={14} className="shrink-0 text-ink-3" />}
          <span className="truncate">{label}</span>
          {tag && <span className="shrink-0 rounded bg-line-2 px-1.5 py-px text-[10px] font-semibold uppercase text-ink-3">{tag}</span>}
        </span>
        <ChevronDown size={14} className={`shrink-0 text-ink-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className={boxed ? 'border-t border-line-2 px-3 py-2.5' : 'pb-1 pt-1'}>{children}</div>}
    </div>
  );
}

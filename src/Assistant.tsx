import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ArrowUp, ChevronRight, LoaderCircle, OctagonAlert, RotateCcw, ShieldAlert } from 'lucide-react';
import type { AgentAnswer, AgentStep, CoverageStatus, Policy, PortfolioData } from '../shared/types';
import { askAgent, fmtMoney } from './format';
import { FEATURED, POPULAR_TOPICS } from './prompts';
import type { AskRequest } from './App';
import { CategoryIcon, Mascot, MascotAvatar, Pill, surface, useMediaQuery, useOverlay } from './ui';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const ASSISTANT_PANEL_ID = 'companion-panel';

type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; answer: AgentAnswer }
  | { id: number; role: 'error'; text: string; retry: string };

let nextId = 1;

/**
 * The assistant page. Tablet and desktop: a page in the app with a centred conversation and (from 1280px) a
 * right-hand rail with the latest answer's sources. Phones: a full-screen view over the dashboard.
 */
export function AssistantView({
  data, active, wide, request, firstName, onOpenPolicy, onClose,
}: {
  data: PortfolioData; active: boolean; wide: boolean; request: AskRequest; firstName: string;
  onOpenPolicy: (p: Policy) => void; onClose: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const reqId = useRef(0);
  const rail = useMediaQuery('(min-width: 1280px)') && wide;

  // Phones: a full-screen modal view (focus trap, Escape, focus return). Wider screens: a normal page.
  useOverlay(panelRef, onClose, true, '[data-ask-trigger]', active && !wide);

  // Cancel any in-flight request on unmount
  useEffect(() => () => { reqId.current++; abortRef.current?.abort(); }, []);

  // Questions asked from elsewhere in the app (timer makes this safe under React's dev double-mount)
  useEffect(() => {
    if (!request) return;
    const t = setTimeout(() => send(request.q), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.n]);

  // While working: follow the conversation. When an answer arrives: show it from its question.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const last = msgs[msgs.length - 1];
    if (!busy && last?.role === 'assistant') {
      const q = el.querySelector<HTMLElement>('[data-last-question]');
      if (q) { el.scrollTo({ top: q.offsetTop - 16, behavior: smooth }); return; }
    }
    el.scrollTo({ top: el.scrollHeight, behavior: smooth });
  }, [msgs, liveSteps, busy]);

  const lastUserId = [...msgs].reverse().find((m) => m.role === 'user')?.id;
  const untrustedNoteId = msgs.find((m) => m.role === 'assistant' && m.answer.untrustedNotice)?.id;
  const latestAnswer = [...msgs].reverse().find((m): m is Extract<Msg, { role: 'assistant' }> => m.role === 'assistant')?.answer;
  const last = msgs[msgs.length - 1];
  const status = busy ? 'Checking your policies…' : last?.role === 'assistant' ? 'Answer ready.' : last?.role === 'error' ? 'That didn’t go through.' : '';
  const empty = msgs.length === 0 && !busy;

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

  const newChat = msgs.length > 0 && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={reset} aria-label="Start a new chat" className="text-ink-2">
          <RotateCcw className="size-[18px]" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>New chat</TooltipContent>
    </Tooltip>
  );

  const conversation = (
    <>
      {msgs.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end" {...(m.id === lastUserId ? { 'data-last-question': '' } : {})}>
            <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-bubble px-4 py-2.5 text-[14px] leading-relaxed text-bubble-ink">{m.text}</p>
          </div>
        ) : m.role === 'error' ? (
          <div key={m.id} className="ml-10 rounded-2xl bg-bad-bg p-4 text-[14px]" role="alert">
            <p className="font-semibold text-bad">That didn’t go through</p>
            <p className="mt-0.5 text-ink-2">{m.text}</p>
            {m.retry && <Button type="button" variant="outline" size="sm" onClick={() => send(m.retry)} className="mt-3 bg-card">Try again</Button>}
          </div>
        ) : (
          <AnswerView key={m.id} a={m.answer} onAsk={send} busy={busy} showUntrusted={m.id === untrustedNoteId} detailsInline={!rail} tinted={wide} />
        ),
      )}
      {busy && <Working steps={liveSteps} />}
    </>
  );

  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mx-auto w-full max-w-[760px]">
      <label htmlFor="companion-input" className="sr-only">Your question</label>
      <div className="flex items-end gap-2 rounded-[28px] border border-line bg-card p-1.5 pl-5 shadow-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <Textarea
          id="companion-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          rows={1}
          maxLength={1500}
          placeholder="Ask anything about your cover…"
          className="field-sizing-content max-h-28 min-h-11 flex-1 resize-none border-0 bg-transparent px-0 py-2.5 text-[15px] shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || busy} className="size-11 shrink-0" aria-label="Send question">
          {busy ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" /> : <ArrowUp className="size-5" aria-hidden="true" />}
        </Button>
      </div>
      <p className="mt-2 text-center text-[12px] text-muted-foreground">Your insurer makes the final decision on claims.</p>
    </form>
  );

  // ---------- phones: full-screen view ----------
  if (!wide) {
    return (
      <section
        ref={panelRef}
        id={ASSISTANT_PANEL_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby="companion-title"
        tabIndex={-1}
        hidden={!active}
        className="animate-sheet fixed inset-0 z-50 flex flex-col bg-background outline-none"
      >
        <header className={`flex h-14 shrink-0 items-center gap-1 px-1.5 pt-[env(safe-area-inset-top)] ${empty ? 'bg-sky-from' : 'border-b bg-card'}`}>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Back" className="text-ink-2">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
          <h2 id="companion-title" className="flex-1 text-center text-[15px] font-semibold">Ditto Assistant</h2>
          {newChat || <span className="size-11" aria-hidden="true" />}
        </header>

        <div ref={scrollRef} className="@container relative flex-1 overflow-y-auto overscroll-contain">
          {empty ? (
            <div className="animate-rise pb-6">
              <div className="rounded-b-[32px] bg-gradient-to-b from-sky-from to-sky-to px-5 pb-6 pt-2 text-center">
                <Mascot className="mx-auto w-28" />
                <p className="mt-2 text-[20px] font-semibold tracking-tight">Hi, {firstName}!</p>
                <p className="text-[18px] font-medium leading-snug tracking-tight text-ink-2">How can I help with your cover?</p>
                <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Quick questions">
                  {FEATURED.map((s) => (
                    <li key={s.q}>
                      <button type="button" onClick={() => send(s.q)} aria-label={`${s.title}: ${s.q}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-medium shadow-card">
                        <s.icon className={`size-[15px] ${s.urgent ? 'text-bad' : 'text-link'}`} aria-hidden="true" />
                        {s.hint}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="px-4 pt-5">
                <h3 className="text-[14px] font-semibold">Popular topics</h3>
                <ul className="mt-3 grid grid-cols-2 gap-3">
                  {POPULAR_TOPICS.map((s) => (
                    <li key={s.q} className="flex">
                      <button type="button" onClick={() => send(s.q)} className={`${surface} flex min-h-24 w-full flex-col justify-between gap-3 p-3.5 text-left`}>
                        <span className="grid size-8 place-items-center rounded-full bg-accent text-link" aria-hidden="true"><s.icon className="size-4" /></span>
                        <span className="text-[13px] font-semibold leading-snug">{s.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="space-y-5 px-4 py-5">{conversation}</div>
          )}
        </div>
        <p className="sr-only" aria-live="polite">{status}</p>
        <div className="shrink-0 bg-background px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2">{composer}</div>
      </section>
    );
  }

  // ---------- tablet and desktop: a page with an optional context rail ----------
  return (
    <section
      ref={panelRef}
      id={ASSISTANT_PANEL_ID}
      role="region"
      aria-labelledby="companion-title"
      tabIndex={-1}
      hidden={!active}
      className="grid h-[calc(100dvh-6.5rem)] min-h-[520px] gap-4 pt-1 outline-none xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className={`${surface} flex min-h-0 flex-col overflow-hidden`}>
        <header className="flex h-14 shrink-0 items-center gap-2 px-5">
          <MascotAvatar />
          <h1 id="companion-title" tabIndex={-1} className="flex-1 text-[15px] font-semibold outline-none">Ditto Assistant</h1>
          {newChat}
        </header>
        <div ref={scrollRef} className="@container relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
          {empty ? (
            <div className="animate-rise mx-auto flex min-h-full max-w-[680px] flex-col items-center justify-center py-8 text-center">
              <Mascot className="w-32" />
              <p className="mt-3 text-[28px] font-medium tracking-tight">Hi {firstName}, how can I help?</p>
              <p className="mt-1 text-[14px] text-muted-foreground">Ask about any of your health and term life policies.</p>
              <ul className="mt-7 grid w-full grid-cols-2 gap-3 text-left" aria-label="Suggested questions">
                {FEATURED.map((s) => (
                  <li key={s.q} className="flex">
                    <button type="button" onClick={() => send(s.q)} aria-label={`${s.title}: ${s.q}`} className="flex w-full items-start gap-3 rounded-2xl border border-line bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${s.urgent ? 'bg-bad-bg text-bad' : 'bg-accent text-link'}`} aria-hidden="true"><s.icon className="size-[17px]" /></span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold">{s.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{s.q}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mx-auto max-w-[760px] space-y-6 py-4">{conversation}</div>
          )}
        </div>
        <p className="sr-only" aria-live="polite">{status}</p>
        <div className="shrink-0 px-5 pb-4 pt-2">{composer}</div>
      </div>

      {rail && (
        <aside aria-label={latestAnswer ? 'About this answer' : 'Your policies'} className={`${surface} hidden min-h-0 flex-col overflow-hidden xl:flex`}>
          <h2 className="px-5 pb-2 pt-5 text-[15px] font-semibold">{latestAnswer ? 'About this answer' : 'Your policies'}</h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {latestAnswer ? <AnswerDetails a={latestAnswer} expanded /> : (
              <>
                <p className="text-[13px] text-muted-foreground">The assistant answers from these policies and cites their clauses.</p>
                <ul className="mt-3 space-y-1">
                  {data.policies.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => onOpenPolicy(p)} data-policy-id={p.id} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition-colors hover:bg-muted/60">
                        <CategoryIcon c={p.category} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                          <span className="block text-[12px] text-muted-foreground">{p.provider}</span>
                        </span>
                        <span className="tnum text-[13px] font-semibold">{fmtMoney(p, p.sumInsured, true)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>
      )}
    </section>
  );
}

// ---------- while working: one quiet line, naming the real local step in progress ----------

function Working({ steps }: { steps: AgentStep[] }) {
  const current = steps[steps.length - 1];
  return (
    <div className="animate-rise flex items-center gap-2.5">
      <MascotAvatar />
      <p className="flex items-center gap-2 text-[14px] text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
        {current ? current.label : 'Checking your policies'}…
      </p>
    </div>
  );
}

// ---------- answer ----------

const STATUS: Record<CoverageStatus, 'ok' | 'warn' | 'neutral'> = { Supported: 'ok', Uncertain: 'warn', 'Not found': 'neutral' };
const GENERIC_UNKNOWN = /^Final decision rests with the insurer/;
const block = 'border-t border-line/70 px-4 py-3.5';
const label = 'mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

function shownCoverage(a: AgentAnswer) {
  return a.coverage.some((c) => c.status !== 'Not found') ? a.coverage.filter((c) => c.status !== 'Not found') : a.coverage;
}

function AnswerView({ a, onAsk, busy, showUntrusted, detailsInline, tinted }: { a: AgentAnswer; onAsk: (q: string) => void; busy: boolean; showUntrusted: boolean; detailsInline: boolean; tinted: boolean }) {
  const coverage = shownCoverage(a);
  return (
    <article className="animate-rise flex gap-2.5" aria-label="Answer">
      <MascotAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {a.safetyNotice && (
          <div className="flex items-center gap-2.5 rounded-2xl bg-urgent px-4 py-3 text-[14px] font-semibold text-white" role="alert">
            <OctagonAlert className="size-5 shrink-0" aria-hidden="true" />
            <p>{a.safetyNotice}</p>
          </div>
        )}

        <div className={`overflow-hidden rounded-3xl rounded-tl-lg ${tinted ? 'bg-background' : 'bg-card shadow-card'}`}>
          <div className="md px-4 py-3.5 text-[14px] leading-relaxed text-ink-2">
            <ReactMarkdown>{a.text}</ReactMarkdown>
          </div>

          {coverage.length > 0 && (
            <ul className={`${block} space-y-3`} aria-label="Coverage by policy">
              {coverage.map((c) => (
                <li key={c.policyId}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold">{c.policyName}</span>
                    <Pill tone={STATUS[c.status]} className="font-semibold">{c.status}</Pill>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{c.reasoning}</p>
                </li>
              ))}
            </ul>
          )}

          {a.cost?.map((c) => (
            <div key={c.policyId} className={block}>
              <p className={label}>Cost estimate · {c.policyName}</p>
              {c.sufficientData ? (
                <>
                  <p className="tnum text-[13px] text-muted-foreground">
                    <span className="text-[20px] font-semibold text-ink">{c.currency}{(c.estimatedOutOfPocket ?? 0).toLocaleString('en-IN')}</span> you may pay ·{' '}
                    {c.currency}{(c.estimatedInsurerShare ?? 0).toLocaleString('en-IN')} insurer may pay
                  </p>
                  <dl className="tnum mt-2 space-y-1 text-[13px]">
                    {c.inputs.map((i) => <div key={i.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{i.label}</dt><dd>{i.value}</dd></div>)}
                    {c.lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l.label}</dt><dd className="whitespace-nowrap">− {c.currency}{l.amount.toLocaleString('en-IN')}</dd></div>)}
                  </dl>
                </>
              ) : (
                <p className="text-[13px] text-ink-2">Needs: <span className="font-medium text-ink">{c.missing.join('; ')}</span></p>
              )}
            </div>
          ))}

          {a.comparison && <ComparisonView c={a.comparison} />}
          {a.plan && <PlanView plan={a.plan} />}

          {a.suggestions && a.suggestions.length > 0 && (
            <div className={`${block} flex flex-wrap gap-2`}>
              {a.suggestions.map((q) => (
                <button key={q} type="button" onClick={() => onAsk(q)} disabled={busy} className="rounded-full border border-line bg-card px-3.5 py-2 text-left text-[13px] font-medium transition-colors hover:border-primary/40 disabled:text-muted-foreground">
                  {q}
                </button>
              ))}
            </div>
          )}

          {showUntrusted && a.untrustedNotice && (
            <p className="flex gap-2 border-t border-line/70 px-4 py-2.5 text-[12px] text-muted-foreground">
              <ShieldAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden="true" />{a.untrustedNotice}
            </p>
          )}

          {detailsInline && <AnswerDetails a={a} />}
        </div>
      </div>
    </article>
  );
}

/** Sources, unverified points, cost assumptions and the local steps. Folded under an answer, or open in the desktop rail. */
function AnswerDetails({ a, expanded = false }: { a: AgentAnswer; expanded?: boolean }) {
  const unknowns = [...new Set(shownCoverage(a).flatMap((c) => c.unknowns).filter((u) => !GENERIC_UNKNOWN.test(u)))];
  const assumptions = a.cost?.flatMap((c) => c.assumptions) ?? [];
  const sections = [
    a.evidence.length > 0 && {
      id: 'sources', title: `Sources · ${a.evidence.length} ${a.evidence.length === 1 ? 'clause' : 'clauses'}`,
      body: (
        <ul className="space-y-3">
          {a.evidence.map((e) => (
            <li key={e.clauseId}>
              <p className="text-[13px] font-semibold">{e.title} <span className="font-normal text-muted-foreground">· {e.policyName}, {e.section}</span></p>
              <blockquote className="mt-1 border-l-2 border-primary/40 pl-3 text-[13px] leading-relaxed text-ink-2">{e.text}</blockquote>
            </li>
          ))}
        </ul>
      ),
    },
    unknowns.length > 0 && {
      id: 'unknowns', title: `Not verified · ${unknowns.length}`,
      body: <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">{unknowns.map((u) => <li key={u}>{u}</li>)}</ul>,
    },
    assumptions.length > 0 && {
      id: 'assumptions', title: a.cost?.some((c) => c.sufficientData) ? 'Cost assumptions' : 'What the policy says about cost',
      body: <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">{assumptions.map((x) => <li key={x}>{x}</li>)}</ul>,
    },
    a.steps.length > 0 && {
      id: 'steps', title: `How this answer was built · ${a.steps.length} ${a.steps.length === 1 ? 'step' : 'steps'}`,
      body: (
        <ol className="space-y-1 text-[13px]">
          {a.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="tnum text-muted-foreground">{i + 1}.</span>
              <span><span className="font-medium">{s.label}</span>{s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}</span>
            </li>
          ))}
        </ol>
      ),
    },
  ].filter(Boolean) as { id: string; title: string; body: React.ReactNode }[];
  if (!sections.length) return null;

  if (expanded) {
    return (
      <div className="space-y-5">
        {sections.map((s) => (
          <section key={s.id} aria-label={s.title}>
            <h3 className={label}>{s.title}</h3>
            {s.body}
          </section>
        ))}
      </div>
    );
  }
  return (
    <Accordion type="multiple" className="border-t border-line/70 px-4">
      {sections.map((s) => (
        <AccordionItem key={s.id} value={s.id} className="border-line/70">
          <AccordionTrigger className="py-3 text-[13px] font-medium text-ink-2 hover:no-underline">{s.title}</AccordionTrigger>
          <AccordionContent>{s.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ComparisonView({ c }: { c: NonNullable<AgentAnswer['comparison']> }) {
  const name = (id: string) => c.policies.find((x) => x.policyId === id)?.policyName ?? id;
  const notSpecified = (v: string) => v.startsWith('Not specified');
  return (
    <div className={block} aria-label="Policy comparison" role="group">
      <p className={label}>Side by side</p>
      <div className="hidden overflow-x-auto @2xl:block">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">Comparison of {c.policies.map((p) => p.policyName).join(' and ')}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-[22%] py-2 pr-3 font-medium text-muted-foreground">Criterion</th>
              {c.policies.map((p) => <th key={p.policyId} scope="col" className="py-2 pr-3 font-semibold">{p.policyName}</th>)}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.criterion} className="border-b border-line/70 align-top last:border-0">
                <th scope="row" className="py-2 pr-3 font-medium text-ink-2">{r.criterion}</th>
                {r.values.map((v) => <td key={v.policyId} className={`py-2 pr-3 leading-snug ${notSpecified(v.value) ? 'italic text-muted-foreground' : ''}`}>{v.value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="space-y-3 @2xl:hidden">
        {c.rows.map((r) => (
          <div key={r.criterion}>
            <dt className="text-[13px] font-semibold">{r.criterion}</dt>
            {r.values.map((v) => (
              <dd key={v.policyId} className="mt-1 text-[13px] leading-snug">
                <span className="text-muted-foreground">{name(v.policyId)}: </span>
                <span className={notSpecified(v.value) ? 'italic text-muted-foreground' : 'text-ink-2'}>{v.value}</span>
              </dd>
            ))}
          </div>
        ))}
      </dl>
      {c.notes.map((n) => <p key={n} className="mt-3 text-[12px] text-muted-foreground">{n}</p>)}
    </div>
  );
}

function PlanView({ plan }: { plan: NonNullable<AgentAnswer['plan']> }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const headingId = useId();
  const baseId = useId();
  return (
    <section className={block} aria-labelledby={headingId}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h4 id={headingId} className={`${label} mb-0 ${plan.urgent ? 'text-bad' : ''}`}>{plan.title}</h4>
        <span className="tnum text-[12px] text-muted-foreground">{done.size}/{plan.steps.length}</span>
      </div>
      <ul>
        {plan.steps.map((s, i) => {
          const on = done.has(i);
          const id = `${baseId}-${i}`;
          return (
            <li key={i} className="flex gap-3 py-1.5">
              <Checkbox id={id} checked={on} onCheckedChange={() => setDone((d) => { const n = new Set(d); if (on) n.delete(i); else n.add(i); return n; })} className="mt-0.5 size-[18px] rounded-md" />
              <label htmlFor={id} className="min-w-0 cursor-pointer">
                <span className={`block text-[14px] font-medium ${on ? 'text-muted-foreground line-through' : ''}`}>{s.text}</span>
                {s.detail && <span className="block text-[12px] leading-snug text-muted-foreground">{s.detail}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

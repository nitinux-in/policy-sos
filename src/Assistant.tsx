import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ArrowUp, Check, ChevronDown, LoaderCircle, OctagonAlert, RotateCcw, ShieldAlert } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion, type Variants } from 'motion/react';
import NumberFlow from '@number-flow/react';
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
import { EASE, SPRING, rise, riseSm, stagger, wait } from './motion';

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
  const [stepsDone, setStepsDone] = useState(false);
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
    setStepsDone(false);
    const ac = new AbortController();
    abortRef.current = ac;
    const my = ++reqId.current;
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      // The local engine answers almost instantly. Its real steps are shown one at a time, briefly enough to read
      // (about 1.5 seconds in all); nothing is shown that the engine didn't actually do.
      let received = 0;
      let reveal = Promise.resolve();
      const onStep = (step: AgentStep) => {
        received++;
        reveal = reveal.then(async () => {
          if (my !== reqId.current) return;
          setLiveSteps((prev) => [...prev, step]);
          await wait(Math.max(220, Math.min(420, 1500 / received)));
        });
      };
      const answer = await askAgent(q, onStep, ac.signal);
      await reveal;
      if (my !== reqId.current) return; // conversation was reset
      if (received) {
        setStepsDone(true);
        await wait(260);
        if (my !== reqId.current) return;
      }
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
        setStepsDone(false);
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
      {msgs.map((msg) =>
        msg.role === 'user' ? (
          <div key={msg.id} className="flex justify-end" {...(msg.id === lastUserId ? { 'data-last-question': '' } : {})}>
            <m.p
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={SPRING}
              style={{ transformOrigin: '100% 100%' }}
              className="max-w-[85%] rounded-3xl rounded-br-lg bg-bubble px-4 py-2.5 text-[14px] leading-relaxed text-bubble-ink"
            >
              {msg.text}
            </m.p>
          </div>
        ) : msg.role === 'error' ? (
          <m.div
            key={msg.id}
            initial={{ opacity: 0, x: 0 }}
            animate={{ opacity: 1, x: [0, -6, 5, -3, 0] }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="ml-10 rounded-2xl bg-bad-bg p-4 text-[14px]"
            role="alert"
          >
            <p className="font-semibold text-bad">That didn’t go through</p>
            <p className="mt-0.5 text-ink-2">{msg.text}</p>
            {msg.retry && <Button type="button" variant="outline" size="sm" onClick={() => send(msg.retry)} className="mt-3 bg-card">Try again</Button>}
          </m.div>
        ) : (
          <AnswerView key={msg.id} a={msg.answer} onAsk={send} busy={busy} showUntrusted={msg.id === untrustedNoteId} detailsInline={!rail} tinted={wide} />
        ),
      )}
      {/* popLayout: as the answer arrives, the step list fades out in place while the answer rises over it */}
      <AnimatePresence mode="popLayout">
        {busy && (
          <m.div
            key="trace"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <AgentTrace steps={liveSteps} done={stepsDone} />
          </m.div>
        )}
      </AnimatePresence>
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
        <Button type="submit" size="icon" disabled={!input.trim() || busy} className="size-11 shrink-0 transition-[background-color,transform] active:scale-90" aria-label="Send question">
          <AnimatePresence mode="wait" initial={false}>
            <m.span
              key={busy ? 'busy' : 'send'}
              initial={{ opacity: 0, scale: 0.4, y: busy ? 0 : 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.4, y: busy ? 0 : -6 }}
              transition={{ duration: 0.16 }}
              className="grid place-items-center"
            >
              {busy ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" /> : <ArrowUp className="size-5" aria-hidden="true" />}
            </m.span>
          </AnimatePresence>
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
          <AnimatePresence mode="wait" initial={false}>
          {empty ? (
            <m.div key="welcome" initial="hidden" animate="show" exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }} variants={stagger(0.06)} className="pb-6">
              <div className="rounded-b-[32px] bg-gradient-to-b from-sky-from to-sky-to px-5 pb-6 pt-2 text-center">
                <m.div variants={rise}><Mascot className="animate-float mx-auto w-28" /></m.div>
                <m.p variants={rise} className="mt-2 text-[20px] font-semibold tracking-tight">Hi, {firstName}!</m.p>
                <m.p variants={rise} className="text-[18px] font-medium leading-snug tracking-tight text-ink-2">How can I help with your cover?</m.p>
                <m.ul variants={stagger(0.04)} className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Quick questions">
                  {FEATURED.map((s) => (
                    <m.li key={s.q} variants={riseSm}>
                      <m.button type="button" whileTap={{ scale: 0.95 }} transition={SPRING} onClick={() => send(s.q)} aria-label={`${s.title}: ${s.q}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-medium shadow-card">
                        <s.icon className={`size-[15px] ${s.urgent ? 'text-bad' : 'text-link'}`} aria-hidden="true" />
                        {s.hint}
                      </m.button>
                    </m.li>
                  ))}
                </m.ul>
              </div>
              <m.div variants={stagger(0.05)} className="px-4 pt-5">
                <m.h3 variants={riseSm} className="text-[14px] font-semibold">Popular topics</m.h3>
                <ul className="mt-3 grid grid-cols-2 gap-3">
                  {POPULAR_TOPICS.map((s) => (
                    <m.li key={s.q} variants={rise} className="flex">
                      <m.button type="button" whileTap={{ scale: 0.97 }} transition={SPRING} onClick={() => send(s.q)} className={`${surface} flex min-h-24 w-full flex-col justify-between gap-3 p-3.5 text-left`}>
                        <span className="grid size-8 place-items-center rounded-full bg-accent text-link" aria-hidden="true"><s.icon className="size-4" /></span>
                        <span className="text-[13px] font-semibold leading-snug">{s.label}</span>
                      </m.button>
                    </m.li>
                  ))}
                </ul>
              </m.div>
            </m.div>
          ) : (
            <m.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative space-y-5 px-4 py-5">{conversation}</m.div>
          )}
          </AnimatePresence>
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
          <AnimatePresence mode="wait" initial={false}>
          {empty ? (
            <m.div key="welcome" initial="hidden" animate="show" exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }} variants={stagger(0.07)} className="mx-auto flex min-h-full max-w-[680px] flex-col items-center justify-center py-8 text-center">
              <m.div variants={rise}><Mascot className="animate-float w-32" /></m.div>
              <m.p variants={rise} className="mt-3 text-[28px] font-medium tracking-tight">Hi {firstName}, how can I help?</m.p>
              <m.p variants={rise} className="mt-1 text-[14px] text-muted-foreground">Ask about any of your health and term life policies.</m.p>
              <m.ul variants={stagger(0.06)} className="mt-7 grid w-full grid-cols-2 gap-3 text-left" aria-label="Suggested questions">
                {FEATURED.map((s) => (
                  <m.li key={s.q} variants={rise} className="flex">
                    <m.button type="button" whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} transition={SPRING} onClick={() => send(s.q)} aria-label={`${s.title}: ${s.q}`} className="flex w-full items-start gap-3 rounded-2xl border border-line bg-card p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-accent/40 hover:shadow-card">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-full ${s.urgent ? 'bg-bad-bg text-bad' : 'bg-accent text-link'}`} aria-hidden="true"><s.icon className="size-[17px]" /></span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold">{s.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{s.q}</span>
                      </span>
                    </m.button>
                  </m.li>
                ))}
              </m.ul>
            </m.div>
          ) : (
            <m.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mx-auto max-w-[760px] space-y-6 py-4">{conversation}</m.div>
          )}
          </AnimatePresence>
        </div>
        <p className="sr-only" aria-live="polite">{status}</p>
        <div className="shrink-0 px-5 pb-4 pt-2">{composer}</div>
      </div>

      {rail && (
        <aside aria-label={latestAnswer ? 'About this answer' : 'Your policies'} className={`${surface} hidden min-h-0 flex-col overflow-hidden xl:flex`}>
          <h2 className="px-5 pb-2 pt-5 text-[15px] font-semibold">{latestAnswer ? 'About this answer' : 'Your policies'}</h2>
          <m.div key={latestAnswer ? msgs.length : 'policies'} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: EASE }} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
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
          </m.div>
        </aside>
      )}
    </section>
  );
}

// ---------- while working: the engine's real local steps, one at a time ----------

function AgentTrace({ steps, done }: { steps: AgentStep[]; done: boolean }) {
  return (
    <div className="flex gap-2.5">
      <span className="relative mt-0.5 grid size-8 shrink-0 self-start">
        <MascotAvatar />
        {!done && <span className="trace-ring" aria-hidden="true" />}
      </span>
      <div className="min-w-0 max-w-md flex-1 rounded-3xl rounded-tl-lg bg-card px-4 py-3 shadow-card">
        <p className={`text-[13px] font-semibold ${done ? 'text-ink' : 'shimmer-text'}`}>{done ? 'Done' : 'Checking your policies'}</p>
        <ol className="mt-1" aria-hidden="true">
          <AnimatePresence initial={false}>
            {steps.map((s, i) => {
              const finished = done || i < steps.length - 1;
              return (
                <m.li
                  key={i}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.28, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2.5 py-1">
                    <span className="mt-px grid size-4 shrink-0 place-items-center">
                      {finished ? (
                        <m.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING} className="grid size-4 place-items-center rounded-full bg-ok text-white dark:text-ok-bg">
                          <Check className="size-2.5" strokeWidth={3.5} />
                        </m.span>
                      ) : (
                        <LoaderCircle className="size-4 animate-spin text-primary" />
                      )}
                    </span>
                    <span className="min-w-0 text-[13px] leading-snug">
                      <span className={`transition-colors duration-300 ${finished ? 'text-ink-2' : 'font-medium text-ink'}`}>{s.label}</span>
                      {s.detail && <span className="block truncate text-[12px] text-muted-foreground">{s.detail}</span>}
                    </span>
                  </div>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      </div>
    </div>
  );
}

// ---------- answer ----------

const STATUS: Record<CoverageStatus, 'ok' | 'warn' | 'neutral'> = { Supported: 'ok', Uncertain: 'warn', 'Not found': 'neutral' };
const GENERIC_UNKNOWN = /^Final decision rests with the insurer/;
const block = 'border-t border-line/70 px-4 py-3.5';
const label = 'mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** The answer card rises in, then its parts follow one after another. */
const card: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, staggerChildren: 0.07, delayChildren: 0.06 } },
};
const pop: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: { opacity: 1, scale: 1, transition: SPRING },
};

// Markdown paragraphs and list items join the reveal sequence
const MD = {
  p: ({ children }: { children?: React.ReactNode }) => <m.p variants={riseSm}>{children}</m.p>,
  ul: ({ children }: { children?: React.ReactNode }) => <m.ul variants={stagger(0.05)}>{children}</m.ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <m.ol variants={stagger(0.05)}>{children}</m.ol>,
  li: ({ children }: { children?: React.ReactNode }) => <m.li variants={riseSm}>{children}</m.li>,
};

function shownCoverage(a: AgentAnswer) {
  return a.coverage.some((c) => c.status !== 'Not found') ? a.coverage.filter((c) => c.status !== 'Not found') : a.coverage;
}

/** An amount that counts up from zero as the answer appears (shown straight away with reduced motion). */
function CountUp({ value, currency, className = '' }: { value: number; currency: string; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 320);
    return () => clearTimeout(t);
  }, [value]);
  return <NumberFlow value={shown} locales="en-IN" prefix={currency} className={className} />;
}

function AnswerView({ a, onAsk, busy, showUntrusted, detailsInline, tinted }: { a: AgentAnswer; onAsk: (q: string) => void; busy: boolean; showUntrusted: boolean; detailsInline: boolean; tinted: boolean }) {
  const coverage = shownCoverage(a);
  return (
    <m.article initial="hidden" animate="show" variants={stagger(0.05)} className="flex gap-2.5" aria-label="Answer">
      <m.span variants={pop} className="mt-0.5 shrink-0"><MascotAvatar /></m.span>
      <div className="min-w-0 flex-1 space-y-2">
        {a.safetyNotice && (
          <m.div variants={riseSm} className="flex items-center gap-2.5 rounded-2xl bg-urgent px-4 py-3 text-[14px] font-semibold text-white" role="alert">
            <OctagonAlert className="size-5 shrink-0" aria-hidden="true" />
            <p>{a.safetyNotice}</p>
          </m.div>
        )}

        <m.div variants={card} className={`overflow-hidden rounded-3xl rounded-tl-lg ${tinted ? 'bg-background' : 'bg-card shadow-card'}`}>
          {a.steps.length > 0 && <StepsSummary steps={a.steps} />}

          <div className={`md px-4 pb-3.5 text-[14px] leading-relaxed text-ink-2 ${a.steps.length ? 'pt-2' : 'pt-3.5'}`}>
            <ReactMarkdown components={MD}>{a.text}</ReactMarkdown>
          </div>

          {coverage.length > 0 && (
            <m.ul variants={stagger(0.07)} className={`${block} space-y-3`} aria-label="Coverage by policy">
              {coverage.map((c) => (
                <m.li key={c.policyId} variants={riseSm}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold">{c.policyName}</span>
                    <m.span variants={pop} className="inline-flex"><Pill tone={STATUS[c.status]} className="font-semibold">{c.status}</Pill></m.span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{c.reasoning}</p>
                </m.li>
              ))}
            </m.ul>
          )}

          {a.cost?.map((c) => (
            <m.div key={c.policyId} variants={riseSm} className={block}>
              <p className={label}>Cost estimate · {c.policyName}</p>
              {c.sufficientData ? (
                <>
                  <p className="tnum text-[13px] text-muted-foreground">
                    <CountUp value={c.estimatedOutOfPocket ?? 0} currency={c.currency} className="text-[20px] font-semibold text-ink" /> you may pay ·{' '}
                    {c.currency}{(c.estimatedInsurerShare ?? 0).toLocaleString('en-IN')} insurer may pay
                  </p>
                  <m.dl variants={stagger(0.04)} className="tnum mt-2 space-y-1 text-[13px]">
                    {c.inputs.map((i) => <m.div variants={riseSm} key={i.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{i.label}</dt><dd>{i.value}</dd></m.div>)}
                    {c.lines.map((l) => <m.div variants={riseSm} key={l.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{l.label}</dt><dd className="whitespace-nowrap">− {c.currency}{l.amount.toLocaleString('en-IN')}</dd></m.div>)}
                  </m.dl>
                </>
              ) : (
                <p className="text-[13px] text-ink-2">Needs: <span className="font-medium text-ink">{c.missing.join('; ')}</span></p>
              )}
            </m.div>
          ))}

          {a.comparison && <ComparisonView c={a.comparison} />}
          {a.plan && <PlanView plan={a.plan} />}

          {a.suggestions && a.suggestions.length > 0 && (
            <m.div variants={stagger(0.05)} className={`${block} flex flex-wrap gap-2`}>
              {a.suggestions.map((q) => (
                <m.button key={q} variants={riseSm} whileTap={{ scale: 0.96 }} type="button" onClick={() => onAsk(q)} disabled={busy} className="rounded-full border border-line bg-card px-3.5 py-2 text-left text-[13px] font-medium transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:text-muted-foreground">
                  {q}
                </m.button>
              ))}
            </m.div>
          )}

          {showUntrusted && a.untrustedNotice && (
            <m.p variants={riseSm} className="flex gap-2 border-t border-line/70 px-4 py-2.5 text-[12px] text-muted-foreground">
              <ShieldAlert className="mt-px size-3.5 shrink-0 text-warn" aria-hidden="true" />{a.untrustedNotice}
            </m.p>
          )}

          {detailsInline && <m.div variants={riseSm}><AnswerDetails a={a} withSteps={false} /></m.div>}
        </m.div>
      </div>
    </m.article>
  );
}

/** "Checked 5 steps": the steps that built this answer, folded away under its header. */
function StepsSummary({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <m.div variants={riseSm} className="px-4 pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="-ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-ink"
      >
        <span className="grid size-4 place-items-center rounded-full bg-ok-bg text-ok" aria-hidden="true"><Check className="size-2.5" strokeWidth={3.5} /></span>
        Checked {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.ol
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: EASE }}
            className="overflow-hidden"
          >
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 py-0.5 pl-1 text-[12px] leading-snug first:pt-1.5">
                <span className="tnum text-muted-foreground">{i + 1}.</span>
                <span><span className="font-medium text-ink-2">{s.label}</span>{s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}</span>
              </li>
            ))}
          </m.ol>
        )}
      </AnimatePresence>
    </m.div>
  );
}

/** Sources, unverified points, cost assumptions and the local steps. Folded under an answer, or open in the desktop rail. */
function AnswerDetails({ a, expanded = false, withSteps = true }: { a: AgentAnswer; expanded?: boolean; withSteps?: boolean }) {
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
    withSteps && a.steps.length > 0 && {
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
    <m.div variants={riseSm} className={block} aria-label="Policy comparison" role="group">
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
    </m.div>
  );
}

function PlanView({ plan }: { plan: NonNullable<AgentAnswer['plan']> }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const headingId = useId();
  const baseId = useId();
  return (
    <m.section variants={stagger(0.05)} className={block} aria-labelledby={headingId}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h4 id={headingId} className={`${label} mb-0 ${plan.urgent ? 'text-bad' : ''}`}>{plan.title}</h4>
        <span className="tnum text-[12px] text-muted-foreground"><NumberFlow value={done.size} />/{plan.steps.length}</span>
      </div>
      <ul>
        {plan.steps.map((s, i) => {
          const on = done.has(i);
          const id = `${baseId}-${i}`;
          return (
            <m.li key={i} variants={riseSm} className="flex gap-3 py-1.5">
              <Checkbox id={id} checked={on} onCheckedChange={() => setDone((d) => { const n = new Set(d); if (on) n.delete(i); else n.add(i); return n; })} className="mt-0.5 size-[18px] rounded-md" />
              <label htmlFor={id} className="min-w-0 cursor-pointer">
                <span className={`strike text-[14px] font-medium transition-colors duration-300 ${on ? 'is-on text-muted-foreground' : ''}`}>{s.text}</span>
                {s.detail && <span className="block text-[12px] leading-snug text-muted-foreground">{s.detail}</span>}
              </label>
            </m.li>
          );
        })}
      </ul>
    </m.section>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, LoaderCircle, OctagonAlert, RotateCcw, ShieldAlert } from 'lucide-react';
import { AnimatePresence, LayoutGroup, m, useReducedMotion, type Variants } from 'motion/react';
import NumberFlow from '@number-flow/react';
import type { AgentAnswer, AgentStep, Confidence, ConfidenceFactor, CoverageStatus, EvidenceItem, FactorStatus, Policy, PortfolioData, Verdict } from '../shared/types';
import { askAgent, fmtMoney } from './format';
import { FEATURED } from './prompts';
import type { AskRequest } from './App';
import { CategoryIcon, Mascot, MascotAvatar, Pill, SEND_BUTTON, surface, TONE, useMediaQuery, useOverlay } from './ui';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SETTLE, SETTLE_FAST, SPRING, rise, riseSm, stagger } from './motion';
import { useSpringSheet } from './sheet';

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
  const viewport = useVisualViewport(active && !wide);
  const reduce = useReducedMotion();
  // Phones: the suggestion card that was tapped morphs into the question bubble (shared layoutId)
  const [morphFrom, setMorphFrom] = useState<string | null>(null);
  const [composerFocus, setComposerFocus] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  // Replays the landing's greeting each time the phone assistant opens
  const [opens, setOpens] = useState(0);
  useEffect(() => { if (active) setOpens((n) => n + 1); }, [active]);
  // Phones: a spring-driven full-screen sheet (same path in and out; drag the header, or the conversation when it's
  // scrolled to the top, to dismiss)
  const sheet = useSpringSheet({ open: active && !wide, onDismiss: onClose, panelRef, scrollRef: scrollRef as React.RefObject<HTMLElement | null> });
  // Ambient loops on the landing settle down: the background drifts for 8 seconds after opening, then holds still
  const [ambient, setAmbient] = useState(true);
  useEffect(() => {
    if (!active) return;
    setAmbient(true);
    const t = setTimeout(() => setAmbient(false), 8000);
    return () => clearTimeout(t);
  }, [active]);

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
  const latestMsg = [...msgs].reverse().find((m): m is Extract<Msg, { role: 'assistant' }> => m.role === 'assistant');
  const latestAnswer = latestMsg?.answer;
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
    if (!wide) { try { navigator.vibrate?.(8); } catch { /* not supported */ } }
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
      // No artificial delay: the answer appears as soon as the local engine responds. Its real steps stream into the
      // live trace while the request is in flight (only visible if it takes a moment), and the answer's own
      // "Checked N steps" header ticks them off quickly as it appears.
      const onStep = (step: AgentStep) => { if (my === reqId.current) setLiveSteps((prev) => [...prev, step]); };
      const answer = await askAgent(q, onStep, ac.signal);
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
        setStepsDone(false);
      }
    }
  }

  function reset() {
    reqId.current++;
    abortRef.current?.abort();
    setMorphFrom(null);
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
              {...(morphFrom === msg.text && msg.id === msgs[0]?.id
                ? { layoutId: `ask-${msg.text}`, transition: { type: 'spring', stiffness: 280, damping: 32, mass: 0.9 } }
                : { initial: { opacity: 0, y: 14, scale: 0.96 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: SPRING })}
              style={{ transformOrigin: '100% 100%', borderRadius: '18px 18px 6px 18px' }}
              className="max-w-[85%] rounded-bubble rounded-br-tail bg-bubble px-4 py-2.5 text-[14px] leading-relaxed text-bubble-ink"
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
            className="ml-10 rounded-card bg-bad-bg p-4 text-[14px]"
            role="alert"
          >
            <p className="font-semibold text-bad">That didn’t go through</p>
            <p className="mt-0.5 text-ink-2">{msg.text}</p>
            {msg.retry && <Button type="button" variant="outline" size="sm" onClick={() => send(msg.retry)} className="mt-3 bg-card">Try again</Button>}
          </m.div>
        ) : (
          <AnswerView key={msg.id} a={msg.answer} onAsk={send} busy={busy} showUntrusted={msg.id === untrustedNoteId} detailsInline={!rail || msg.id !== latestMsg?.id} tinted={wide} />
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
            transition={{ ...SETTLE_FAST, delay: 0.3 }}
          >
            <AgentTrace steps={liveSteps} done={stepsDone} />
          </m.div>
        )}
      </AnimatePresence>
    </>
  );

  const hasText = !!input.trim();
  const composer = (glass = false) => (
    <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mx-auto w-full max-w-[760px]">
      <label htmlFor="companion-input" className="sr-only">Your question</label>
      <m.div
        animate={{ scale: composerFocus && !wide ? 1.015 : 1, y: composerFocus && !wide ? -2 : 0 }}
        transition={SPRING}
        className={`flex items-end gap-2 rounded-[28px] border p-1.5 pl-5 transition-[background-color,border-color,box-shadow] duration-500 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 ${
          glass ? 'border-white/70 bg-card/75 shadow-float backdrop-blur-xl dark:border-white/10 dark:bg-card/70 [@media(pointer:coarse)]:bg-card/95 [@media(pointer:coarse)]:backdrop-blur-sm' : 'border-line bg-card shadow-card'
        }`}
      >
        <Textarea
          id="companion-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Never send while an input method (IME) is composing text
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(input); }
          }}
          name="question"
          autoComplete="off"
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck
          onFocus={() => setComposerFocus(true)}
          onBlur={() => setComposerFocus(false)}
          rows={1}
          maxLength={1500}
          placeholder="Ask anything about your cover…"
          enterKeyHint="send"
          // 16px on phones so iOS Safari doesn't zoom the page when the field is focused
          className="field-sizing-content max-h-28 min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-2.5 text-[16px] shadow-none focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
        />
        <Button type="submit" size="icon" disabled={!hasText || busy} className={`${SEND_BUTTON} size-11 ${busy ? 'disabled:bg-primary disabled:text-white' : ''}`} aria-label="Send question">
          <AnimatePresence mode="wait" initial={false}>
            <m.span
              key={busy ? 'busy' : hasText ? 'ready' : 'idle'}
              initial={{ opacity: 0, scale: 0.4, y: busy ? 0 : 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.4, y: busy ? 0 : -8 }}
              transition={hasText && !busy ? { type: 'spring', stiffness: 520, damping: 22 } : { duration: 0.16 }}
              className="grid place-items-center"
            >
              {busy ? <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" /> : <ArrowUp className="size-5" aria-hidden="true" />}
            </m.span>
          </AnimatePresence>
        </Button>
      </m.div>
      <p className="mt-2 text-center text-[12px] text-muted-foreground">Your insurer makes the final decision on claims.</p>
    </form>
  );

  // "Jump to latest": shown when the person has scrolled up during a conversation
  // (only after the person scrolls up themselves, not when a long answer arrives)
  const lastTop = useRef(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = el.scrollTop < lastTop.current - 4;
    lastTop.current = el.scrollTop;
    if (fromBottom < 120) { if (awayFromLatest) setAwayFromLatest(false); }
    else if (scrolledUp && fromBottom > 240 && !awayFromLatest) setAwayFromLatest(true);
  };
  const jump = (
    <AnimatePresence>
      {!empty && awayFromLatest && (
        <m.button
          type="button"
          initial={{ opacity: 0, y: 10, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.8 }}
          transition={SPRING}
          whileTap={{ scale: 0.9 }}
          onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })}
          aria-label="Jump to latest"
          className="absolute bottom-3 left-1/2 z-10 -ml-5 grid size-10 place-items-center rounded-full border border-line bg-card text-ink-2 shadow-float hover:text-ink"
        >
          <ArrowDown className="size-[18px]" aria-hidden="true" />
        </m.button>
      )}
    </AnimatePresence>
  );

  // ---------- phones: full-screen view ----------
  if (!wide) {
    const listening = composerFocus || hasText;
    return (
      <>
      {/* Scrim: the screen behind dims in proportion to how far the sheet is open */}
      <m.div aria-hidden="true" hidden={!sheet.present} style={{ opacity: sheet.progress }} className="pointer-events-none fixed inset-0 z-50 bg-black/40" />
      <m.section
        ref={panelRef}
        id={ASSISTANT_PANEL_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby="companion-title"
        tabIndex={-1}
        hidden={!sheet.present}
        // Sized to the visual viewport, so the composer stays above the on-screen keyboard
        style={{ y: sheet.offset, ...(viewport ? { top: viewport.top, height: viewport.height, bottom: 'auto' } : {}) }}
        className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background outline-none"
      >
        {/* The landing's sky fills the whole screen and fades to the chat background once the conversation starts */}
        <m.div
          aria-hidden="true"
          initial={false}
          animate={{ opacity: empty ? 1 : 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} /* opacity crossfade only */
          className="pointer-events-none absolute inset-0 overflow-hidden bg-gradient-to-b from-sky-from via-sky-to to-sky-to"
        >
          <span className="blob blob-a" style={{ animationPlayState: ambient ? 'running' : 'paused' }} />
          <span className="blob blob-b" style={{ animationPlayState: ambient ? 'running' : 'paused' }} />
        </m.div>

        <header
          {...sheet.handleProps}
          className={`relative flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 touch-none select-none items-center gap-1 border-b px-1.5 pt-[env(safe-area-inset-top)] transition-[background-color,border-color] duration-500 ${empty ? 'border-transparent bg-transparent' : 'border-line bg-card'}`}
        >
          {/* Grab handle: swipe down to close */}
          <span className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+5px)] h-1 w-9 -translate-x-1/2 rounded-full bg-ink/15 dark:bg-white/20" aria-hidden="true" />
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Back" className="text-ink-2">
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
          <h2 id="companion-title" className="flex-1 text-center text-[15px] font-semibold">Ditto Assistant</h2>
          {newChat || <span className="size-11" aria-hidden="true" />}
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <m.div ref={scrollRef} layoutScroll onScroll={onScroll} className="@container relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
            <LayoutGroup>
            <AnimatePresence mode="popLayout" initial={false}>
            {empty ? (
              <m.div
                key="welcome"
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                variants={stagger(0.06)}
                className="flex min-h-full flex-col justify-center px-4 pb-10 pt-1"
              >
                <div className="relative mx-auto grid place-items-center">
                  <m.span
                    aria-hidden="true"
                    animate={listening ? { opacity: reduce ? 0.9 : [0.55, 0.95, 0.55], scale: 1.12 } : { opacity: 0.55, scale: 1 }}
                    transition={listening && !reduce ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
                    className="absolute size-36 rounded-full bg-primary/30 blur-2xl dark:bg-primary/40"
                  />
                  <m.div variants={rise} className="relative">
                    <m.div animate={listening ? { scale: 1.06, rotate: -4, y: -2 } : { scale: 1, rotate: 0, y: 0 }} transition={SPRING}>
                      {/* Floats for two cycles after opening, and keeps floating while the person types */}
                      <span className="animate-float block" style={{ animationIterationCount: listening ? 'infinite' : 2 }}><Mascot className="w-24" /></span>
                    </m.div>
                  </m.div>
                </div>
                {/* Re-keyed on each open so the greeting replays; it holds nothing focusable */}
                <m.div key={opens} initial="hidden" animate="show" className="mt-3 text-center">
                  <WordReveal as="p" text={`Hi, ${firstName}`} className="text-[14px] font-medium text-ink-2" />
                  <WordReveal as="h3" text="How can I help with your cover?" delay={0.12} className="mx-auto mt-1 max-w-[17em] text-[22px] font-semibold leading-tight tracking-tight text-ink" />
                </m.div>
                <m.ul variants={stagger(0.06, 0.25)} className="mt-6 space-y-2" aria-label="Suggested questions">
                  {FEATURED.map((s) => (
                    <m.li key={s.q} variants={riseSm}>
                      <m.button
                        type="button"
                        layoutId={`ask-${s.q}`}
                        whileTap={{ scale: 0.98 }}
                        transition={SPRING}
                        onClick={() => { setMorphFrom(s.q); send(s.q); }}
                        aria-label={`${s.title}: ${s.q}`}
                        style={{ borderRadius: 16 }}
                        className="flex w-full items-center gap-3 border border-white/70 bg-card/70 p-3 text-left shadow-card backdrop-blur-md transition-colors hover:bg-card/90 dark:border-white/[0.06] dark:bg-card/60 [@media(pointer:coarse)]:bg-card/90 [@media(pointer:coarse)]:backdrop-blur-none"
                      >
                        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${s.urgent ? 'bg-bad-bg text-bad' : 'bg-accent text-link'}`} aria-hidden="true">
                          <s.icon className="size-[17px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold leading-tight text-ink">{s.title}</span>
                          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{s.q}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </m.button>
                    </m.li>
                  ))}
                </m.ul>
              </m.div>
            ) : (
              <m.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative space-y-5 px-4 py-5">{conversation}</m.div>
            )}
            </AnimatePresence>
            </LayoutGroup>
          </m.div>
          {jump}
        </div>
        <p className="sr-only" aria-live="polite">{status}</p>
        <div className={`relative shrink-0 px-3 pt-2 ${viewport?.keyboard ? 'pb-2' : 'pb-[max(env(safe-area-inset-bottom),10px)]'}`}>{composer(empty)}</div>
      </m.section>
      </>
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
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="@container relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
          <AnimatePresence mode="wait" initial={false}>
          {empty ? (
            <m.div key="welcome" initial="hidden" animate="show" exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }} variants={stagger(0.07)} className="mx-auto flex min-h-full max-w-[680px] flex-col items-center justify-center py-8 text-center">
              <m.div variants={rise}><span className="animate-float block" style={{ animationIterationCount: composerFocus || hasText ? 'infinite' : 2 }}><Mascot className="w-32" /></span></m.div>
              <m.p variants={rise} className="mt-3 text-[28px] font-medium tracking-tight">Hi {firstName}, how can I help?</m.p>
              <m.p variants={rise} className="mt-1 text-[14px] text-muted-foreground">Ask about any of your health and term life policies.</m.p>
              <m.ul variants={stagger(0.06)} className="mt-7 grid w-full grid-cols-2 gap-3 text-left" aria-label="Suggested questions">
                {FEATURED.map((s) => (
                  <m.li key={s.q} variants={rise} className="flex">
                    <m.button type="button" whileTap={{ scale: 0.97 }} transition={SPRING} onClick={() => send(s.q)} aria-label={`${s.title}: ${s.q}`} className="flex w-full items-start gap-3 rounded-card border border-line bg-card p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-accent/40 hover:shadow-card">
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
        {jump}
        </div>
        <p className="sr-only" aria-live="polite">{status}</p>
        <div className="shrink-0 px-5 pb-4 pt-2">{composer()}</div>
      </div>

      {rail && (
        <aside aria-label={latestAnswer ? 'About this answer' : 'Your policies'} className={`${surface} hidden min-h-0 flex-col overflow-hidden xl:flex`}>
          <h2 className="px-5 pb-2 pt-5 text-[15px] font-semibold">{latestAnswer ? 'About this answer' : 'Your policies'}</h2>
          <m.div key={latestAnswer ? msgs.length : 'policies'} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={SETTLE} className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {latestAnswer ? <AnswerDetails a={latestAnswer} /> : (
              <>
                <p className="text-[13px] text-muted-foreground">The assistant answers from these policies and cites their clauses.</p>
                <ul className="mt-3 space-y-1">
                  {data.policies.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => onOpenPolicy(p)} data-policy-id={p.id} className="flex w-full items-center gap-3 rounded-card p-2 text-left transition-colors hover:bg-muted/60">
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

/**
 * Phones: the visual viewport (the part of the screen not covered by the on-screen keyboard), so the full-screen
 * assistant can keep its composer in view while typing. Null when not in use or unsupported.
 */
function useVisualViewport(enabled: boolean) {
  const [vp, setVp] = useState<{ height: number; top: number; keyboard: boolean } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!enabled || !v) return;
    const update = () => setVp({ height: v.height, top: v.offsetTop, keyboard: window.innerHeight - v.height > 120 });
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => {
      v.removeEventListener('resize', update);
      v.removeEventListener('scroll', update);
      setVp(null);
    };
  }, [enabled]);
  return vp;
}

/** A line of text revealed word by word (fade, slight rise and un-blur; just a fade with reduced motion). */
function WordReveal({ text, as, className = '', delay = 0 }: { text: string; as: 'p' | 'h3'; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  const Tag = as === 'p' ? m.p : m.h3;
  const word: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: 'blur(6px)' },
    show: reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)', transition: SETTLE },
  };
  const words = text.split(' ');
  return (
    <Tag variants={stagger(0.05, delay)} className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true">
          <m.span variants={word} className="inline-block">{w}</m.span>{i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
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
      <div className="min-w-0 max-w-md flex-1 rounded-card rounded-tl-tail bg-card px-4 py-3 shadow-card">
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
                  transition={SETTLE_FAST}
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
  show: { opacity: 1, y: 0, transition: { ...SETTLE, staggerChildren: 0.045, delayChildren: 0.03 } },
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
/** Inline markdown (bold, emphasis) inside a single line such as a key point. */
const INLINE_MD = { p: ({ children }: { children?: React.ReactNode }) => <>{children}</> };

const VERDICT: Record<Exclude<Verdict, 'info'>, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  yes: { label: 'Yes', tone: 'ok' },
  likely: { label: 'Likely', tone: 'ok' },
  partial: { label: 'Partly', tone: 'warn' },
  depends: { label: 'Depends', tone: 'warn' },
  unlikely: { label: 'Unlikely', tone: 'bad' },
  no: { label: 'No', tone: 'bad' },
};

const LEVEL: Record<Confidence['level'], { filled: number; bar: string }> = {
  high: { filled: 3, bar: 'bg-ok' },
  medium: { filled: 2, bar: 'bg-warn' },
  low: { filled: 1, bar: 'bg-bad' },
};

const FACTOR: Record<FactorStatus, { glyph: string; tone: string; sr: string; order: number }> = {
  risk: { glyph: '!', tone: TONE.bad, sr: 'Risk', order: 0 },
  check: { glyph: '?', tone: TONE.warn, sr: 'To confirm', order: 1 },
  unknown: { glyph: '–', tone: TONE.neutral, sr: 'Not in the policy data', order: 2 },
  clear: { glyph: '✓', tone: TONE.ok, sr: 'Clear', order: 4 },
};
/** A known deduction (co-pay, sub-limit…): it lowers the payout but doesn't stop the claim. */
const DEDUCTION = { glyph: '−', tone: TONE.warn, sr: 'Deduction', order: 3 };
const isDeduction = (f: ConfidenceFactor) => f.status === 'risk' && f.impact === 'reduces';
const factorStyle = (f: ConfidenceFactor) => (isDeduction(f) ? DEDUCTION : FACTOR[f.status]);

/** "2 things to check · 1 deduction" */
function factorSummary(factors: ConfidenceFactor[]) {
  const deductions = factors.filter(isDeduction).length;
  const toCheck = factors.filter((f) => f.status !== 'clear' && !isDeduction(f)).length;
  const parts = [
    toCheck > 0 && `${toCheck} ${toCheck === 1 ? 'thing' : 'things'} to check`,
    deductions > 0 && `${deductions} ${deductions === 1 ? 'deduction' : 'deductions'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `What was checked · ${factors.length}`;
}

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
  const verdict = a.verdict && a.verdict !== 'info' ? VERDICT[a.verdict] : null;
  const text = a.text?.trim();
  const keyPoints = a.keyPoints?.filter(Boolean) ?? [];
  const folded = [...detailSections(a), ...(detailsInline ? evidenceSections(a, { withSteps: false }) : [])];
  return (
    <m.article initial="hidden" animate="show" variants={stagger(0.05)} className="flex min-w-0 gap-2.5" aria-label="Answer">
      <m.span variants={pop} className="mt-0.5 shrink-0"><MascotAvatar /></m.span>
      <div className="min-w-0 flex-1 space-y-2">
        {a.safetyNotice && (
          <m.div variants={riseSm} className="flex items-center gap-2 rounded-tile bg-urgent px-3.5 py-2 text-[13px] font-semibold leading-snug text-white" role="alert">
            <OctagonAlert className="size-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0">{a.safetyNotice}</p>
          </m.div>
        )}

        <m.div variants={card} className={`overflow-hidden rounded-card rounded-tl-tail ${tinted ? 'bg-background' : 'bg-card shadow-card'}`}>
          {a.steps.length > 0 && <StepsSummary steps={a.steps} />}

          {/* The direct answer first: verdict, one-line headline, then a few scannable points */}
          {(a.headline || keyPoints.length > 0 || text) && (
          <div className={`px-4 pb-3.5 ${a.steps.length ? 'pt-2' : 'pt-3.5'}`}>
            {a.headline && (
              <>
                {verdict && (
                  <m.p variants={pop} className="mb-1.5 flex">
                    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold ${TONE[verdict.tone]}`}>
                      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                      <span className="sr-only">Short answer: </span>{verdict.label}
                    </span>
                  </m.p>
                )}
                <m.h3 variants={riseSm} className="text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">{a.headline}</m.h3>
              </>
            )}
            {keyPoints.length > 0 && (
              <m.ul variants={stagger(0.05)} className={`${a.headline ? 'mt-2.5' : ''} space-y-1.5`} aria-label="Key points">
                {keyPoints.map((k) => (
                  <m.li key={k} variants={riseSm} className="flex gap-2.5 text-[14px] leading-snug text-ink-2">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span className="md min-w-0"><ReactMarkdown components={INLINE_MD}>{k}</ReactMarkdown></span>
                  </m.li>
                ))}
              </m.ul>
            )}
            {text && (
              <div className={`md text-[14px] leading-relaxed text-ink-2 ${a.headline || keyPoints.length ? 'mt-3' : ''}`}>
                <ReactMarkdown components={MD}>{text}</ReactMarkdown>
              </div>
            )}
          </div>
          )}

          {a.confidence && <ConfidenceStrip c={a.confidence} evidence={a.evidence} inline={detailsInline} />}

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

          {folded.length > 0 && <m.div variants={riseSm}><FoldedSections sections={folded} /></m.div>}

          {a.suggestions && a.suggestions.length > 0 && (
            <m.div variants={stagger(0.05)} className={`${block} flex flex-wrap gap-2`}>
              {a.suggestions.map((q) => (
                <m.button key={q} variants={riseSm} whileTap={{ scale: 0.96 }} type="button" onClick={() => onAsk(q)} disabled={busy} className="min-h-9 max-w-full rounded-full border border-line bg-card px-3.5 py-2 text-left text-[13px] font-medium leading-snug transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:text-muted-foreground">
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
        </m.div>
      </div>
    </m.article>
  );
}

/**
 * How sure the answer is: a label, a three-step meter and one line of reasoning, then (on demand) the specific
 * things that could change the outcome. On wide desktops the list lives in the "About this answer" rail instead.
 */
function ConfidenceStrip({ c, evidence, inline }: { c: Confidence; evidence: EvidenceItem[]; inline: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const lvl = LEVEL[c.level];
  const toggleLabel = factorSummary(c.factors);
  return (
    <m.section variants={riseSm} aria-label="How sure this answer is" className="border-t border-line/70 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <m.span
              key={i}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ ...SETTLE_FAST, delay: 0.2 + i * 0.06 }}
              style={{ transformOrigin: '0 50%' }}
              className={`h-1.5 w-4 rounded-full ${i < lvl.filled ? lvl.bar : 'bg-line'}`}
            />
          ))}
        </span>
        <p className="text-[13px] font-semibold text-ink">{c.label}</p>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{c.reason}</p>
      {c.factors.length > 0 && (inline ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => setOpen((o) => !o)}
            className="-ml-1 mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-full px-1 text-[13px] font-semibold text-link transition-colors hover:text-primary-strong"
          >
            {toggleLabel}
            <ChevronDown className={`size-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <m.div
                id={id}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={SETTLE_FAST}
                className="overflow-hidden"
              >
                <FactorList factors={c.factors} evidence={evidence} />
              </m.div>
            )}
          </AnimatePresence>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-muted-foreground">{toggleLabel}: see “About this answer”.</p>
      ))}
    </m.section>
  );
}

/** The confidence factors, most serious first, each with its detail and the clauses it rests on. */
function FactorList({ factors, evidence }: { factors: ConfidenceFactor[]; evidence: EvidenceItem[] }) {
  const sorted = [...factors].sort((x, y) => factorStyle(x).order - factorStyle(y).order);
  const main = sorted.filter((f) => !isDeduction(f) && f.status !== 'clear');
  const deductions = sorted.filter(isDeduction);
  const clear = sorted.filter((f) => f.status === 'clear');
  const group = (title: string, items: ConfidenceFactor[]) =>
    items.length > 0 && (
      <div>
        <p className="pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
        <ul className="space-y-0.5">{items.map((f) => <FactorRow key={f.id} f={f} evidence={evidence} />)}</ul>
      </div>
    );
  return (
    <div className="pt-1">
      {group('Could change the answer', main)}
      {group('Deductions', deductions)}
      {group('Checked and clear', clear)}
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        Based on the policy wording, not a promise of payment. Your insurer makes the final decision on each claim.
      </p>
    </div>
  );
}

function FactorRow({ f, evidence }: { f: ConfidenceFactor; evidence: EvidenceItem[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const s = factorStyle(f);
  const sources = (f.clauseIds ?? [])
    .map((cid) => evidence.find((e) => e.clauseId === cid))
    .filter((e): e is EvidenceItem => !!e);
  const expandable = !!f.detail || sources.length > 0;
  const body = (
    <>
      <span className={`mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold leading-none ${s.tone}`} aria-hidden="true">{s.glyph}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink"><span className="sr-only">{s.sr}: </span>{f.label}</span>
        <span className="block text-[13px] leading-snug text-ink-2">{f.summary}</span>
      </span>
    </>
  );
  return (
    <li>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
          className="focus-ring-inset -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-tile px-2 py-2 text-left transition-colors hover:bg-muted/60"
        >
          {body}
          <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      ) : (
        <div className="flex items-start gap-2.5 py-2">{body}</div>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SETTLE_FAST}
            className="overflow-hidden"
          >
            <div className="pb-2 pl-[30px] text-[13px] leading-relaxed text-ink-2">
              {f.detail && <div className="md"><ReactMarkdown>{f.detail}</ReactMarkdown></div>}
              {sources.length > 0 && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  From {sources.map((e) => `${e.policyName}, ${e.section}`).join(' · ')}
                </p>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </li>
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
            transition={SETTLE_FAST}
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

type Section = { id: string; title: string; summary?: string; body: React.ReactNode };

/** The engine's longer explanations (markdown), folded away under the answer. */
function detailSections(a: AgentAnswer): Section[] {
  return (a.details ?? []).map((d) => ({
    id: `detail-${d.id}`,
    title: d.title,
    summary: d.summary,
    body: <div className="md text-[13px] leading-relaxed text-ink-2"><ReactMarkdown>{d.body}</ReactMarkdown></div>,
  }));
}

/** Sources, unverified points, cost assumptions and (optionally) the confidence factors and local steps. */
function evidenceSections(a: AgentAnswer, { withSteps = true, withConfidence = false } = {}): Section[] {
  // When the answer carries confidence factors, they already list what isn't verified, so skip the duplicate list
  const unknowns = a.confidence ? [] : [...new Set(shownCoverage(a).flatMap((c) => c.unknowns).filter((u) => !GENERIC_UNKNOWN.test(u)))];
  const assumptions = a.cost?.flatMap((c) => c.assumptions) ?? [];
  return [
    withConfidence && a.confidence && a.confidence.factors.length > 0 && {
      id: 'confidence', title: 'What the confidence rests on',
      body: <FactorList factors={a.confidence.factors} evidence={a.evidence} />,
    },
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
  ].filter(Boolean) as Section[];
}

/** Longer content under an answer, one accordion item per section, all closed to start. */
function FoldedSections({ sections }: { sections: Section[] }) {
  return (
    <Accordion type="multiple" className="border-t border-line/70 px-4">
      {sections.map((s) => (
        <AccordionItem key={s.id} value={s.id} className="border-line/70">
          <AccordionTrigger className="py-3 text-[13px] font-medium text-ink-2 hover:no-underline">
            <span className="min-w-0">
              <span className="block">{s.title}</span>
              {s.summary && <span className="mt-0.5 block text-[12px] font-normal leading-snug text-muted-foreground">{s.summary}</span>}
            </span>
          </AccordionTrigger>
          <AccordionContent>{s.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** The desktop rail: everything about the latest answer, open. */
function AnswerDetails({ a }: { a: AgentAnswer }) {
  const sections = evidenceSections(a, { withConfidence: true });
  if (!sections.length) return null;
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

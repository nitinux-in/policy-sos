import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, LayoutGrid, MessageCircleQuestion, Receipt, Shield } from 'lucide-react';
import type { Policy, PortfolioData } from '../shared/types';
import { ClaimsScreen, DocumentsScreen, OverviewScreen, PoliciesScreen, PolicySheet } from './screens';
import { AssistantView } from './Assistant';
import { DittoLogo, PersonAvatar, ThemeToggle, useMediaQuery, useTheme } from './ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LazyMotion, MotionConfig, m } from 'motion/react';
import { SPRING } from './motion';

const loadMotionFeatures = () => import('./motion-features').then((mod) => mod.default);

export type Tab = 'overview' | 'assistant' | 'policies' | 'claims' | 'documents';

const NAV: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'overview', label: 'Home', icon: LayoutGrid },
  { id: 'assistant', label: 'Assistant', icon: MessageCircleQuestion },
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'claims', label: 'Claims', icon: Receipt },
  { id: 'documents', label: 'Documents', icon: FileText },
];

export type AskRequest = { q: string; n: number } | null;

export default function App() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [returnTab, setReturnTab] = useState<Tab>('overview');
  const [openPolicy, setOpenPolicy] = useState<Policy | null>(null);
  // The assistant keeps its conversation while people move between tabs, so it stays mounted once opened
  const [assistantMounted, setAssistantMounted] = useState(false);
  const [request, setRequest] = useState<AskRequest>(null);
  const wide = useMediaQuery('(min-width: 768px)');
  const [theme, toggleTheme] = useTheme();

  // On tab change: name the page in the document title and move focus to its heading, so keyboard and
  // screen-reader users land at the start of the new content (skipped on first load).
  const prevTab = useRef(tab);
  useEffect(() => {
    const label = NAV.find((t) => t.id === tab)?.label ?? '';
    document.title = `${label} · Ditto`;
    if (prevTab.current === tab) return;
    const from = prevTab.current;
    prevTab.current = tab;
    // On phones the full-screen assistant manages focus itself: in on open, back to the Ask button on close
    if (!wide && (tab === 'assistant' || from === 'assistant')) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1:not([hidden] *)')?.focus({ preventScroll: true }));
  }, [tab, wide]);

  const load = () => {
    setLoadError(null);
    fetch('/api/portfolio')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Server returned ${r.status}`))))
      .then(setData)
      .catch((e) => setLoadError(e.message || 'Could not reach the server'));
  };
  useEffect(load, []);

  const goTo = useCallback((t: Tab) => {
    setOpenPolicy(null);
    if (t === 'assistant') setAssistantMounted(true);
    setTab((current) => {
      if (t === 'assistant' && current !== 'assistant') setReturnTab(current);
      return t;
    });
    window.scrollTo({ top: 0 });
  }, []);

  /** Opens the assistant, optionally asking a question straight away. */
  const ask = useCallback((prompt?: string) => {
    goTo('assistant');
    if (prompt) setRequest({ q: prompt, n: Date.now() });
  }, [goTo]);

  // Shortcut: /?ask=your+question opens the assistant with that question
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('ask');
    if (q) ask(q.slice(0, 1500));
  }, [ask]);

  const first = data?.user.name.split(' ')[0] ?? '';

  return (
    <LazyMotion features={loadMotionFeatures} strict>
    <MotionConfig reducedMotion="user">
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh">
        <a href="#main" className="sr-only z-[60] rounded-full bg-primary px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
          Skip to content
        </a>

        <header className="sticky top-0 z-30 bg-background">
          <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-4 px-4 md:h-20 md:px-6">
            <DittoLogo className="h-6 md:h-7" />

            {/* Tablet and desktop: pill navigation */}
            <nav aria-label="Main" className="mx-auto hidden md:block">
              <ul className="flex items-center gap-1 rounded-full bg-card p-1 shadow-card">
                {NAV.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => (t.id === 'assistant' ? ask() : goTo(t.id))}
                      aria-current={tab === t.id ? 'page' : undefined}
                      {...(t.id === 'assistant' ? { 'data-ask-trigger': '' } : {})}
                      className="relative flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink-2 transition-colors duration-200 hover:text-ink aria-[current=page]:text-white dark:aria-[current=page]:text-accent-foreground lg:px-5"
                    >
                      {/* The highlight glides from the previous tab to this one */}
                      {tab === t.id && <m.span layoutId="nav-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-ink dark:bg-accent" aria-hidden="true" />}
                      <span className="relative flex items-center gap-2">
                        {t.id === 'assistant' && <MessageCircleQuestion className="size-4" aria-hidden="true" />}
                        {t.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="ml-auto flex items-center gap-2 md:ml-0">
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
              {data && <PersonAvatar name={data.user.name} />}
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="@container mx-auto w-full max-w-[1360px] px-4 pb-32 outline-none md:px-6 md:pb-10">
          {!data && !loadError && <LoadingState />}
          {loadError && (
            <div className="mx-auto max-w-md py-24 text-center" role="alert">
              <h1 className="text-[20px] font-semibold">Couldn’t load your policies</h1>
              <p className="mt-2 text-ink-2">{loadError}. Make sure the app server is running, then try again.</p>
              <Button type="button" onClick={load} className="mt-5">Try again</Button>
            </div>
          )}
          {data && tab === 'overview' && <OverviewScreen data={data} onOpenPolicy={setOpenPolicy} onAsk={ask} onNavigate={goTo} />}
          {data && tab === 'policies' && <PoliciesScreen data={data} onOpenPolicy={setOpenPolicy} onAsk={ask} />}
          {data && tab === 'claims' && <ClaimsScreen data={data} onAsk={ask} />}
          {data && tab === 'documents' && <DocumentsScreen data={data} />}
          {data && assistantMounted && (
            <AssistantView
              data={data}
              active={tab === 'assistant'}
              wide={wide}
              request={request}
              firstName={first}
              onOpenPolicy={setOpenPolicy}
              onClose={() => goTo(returnTab === 'assistant' ? 'overview' : returnTab)}
            />
          )}
        </main>

        {/* Phone: floating dark pill navigation with the assistant in the middle */}
        {data && (
          <nav aria-label="Main" className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-40 md:hidden">
            <ul className="grid h-16 grid-cols-5 items-center rounded-full bg-ink px-1.5 shadow-float dark:bg-[#232831]">
              {(['overview', 'policies', 'assistant', 'claims', 'documents'] as const).map((id) => {
                const t = NAV.find((n) => n.id === id)!;
                const current = tab === id;
                if (id === 'assistant') {
                  return (
                    <li key={id} className="flex justify-center">
                      <m.button
                        type="button"
                        onClick={() => ask()}
                        data-ask-trigger=""
                        aria-label="Ask a question"
                        aria-current={current ? 'page' : undefined}
                        whileTap={{ scale: 0.9 }}
                        transition={SPRING}
                        className="grid size-12 place-items-center rounded-full bg-primary text-white shadow-float transition-colors hover:bg-primary-strong"
                      >
                        <MessageCircleQuestion className="size-[22px]" aria-hidden="true" />
                      </m.button>
                    </li>
                  );
                }
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => goTo(id)}
                      aria-current={current ? 'page' : undefined}
                      className={`relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[12px] font-medium transition-colors duration-200 ${current ? 'text-white' : 'text-white/60 hover:text-white'}`}
                    >
                      {current && <m.span layoutId="phone-nav-pill" transition={SPRING} className="absolute inset-x-0.5 inset-y-1 rounded-full bg-white/12" aria-hidden="true" />}
                      <t.icon className="relative size-5" strokeWidth={current ? 2.2 : 1.8} aria-hidden="true" />
                      <span className="relative">{id === 'documents' ? 'Docs' : t.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <PolicySheet policy={openPolicy} onClose={() => setOpenPolicy(null)} onAsk={ask} />
      </div>
    </TooltipProvider>
    </MotionConfig>
    </LazyMotion>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4 pt-4" aria-busy="true" aria-label="Loading your policies">
      <Skeleton className="h-10 w-48 rounded-full" />
      <Skeleton className="h-56 rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-3xl" />)}
      </div>
    </div>
  );
}

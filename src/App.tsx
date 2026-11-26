import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FileText, LayoutGrid, Receipt, Shield, type LucideIcon } from 'lucide-react';
import type { Policy, PortfolioData } from '../shared/types';
import { ClaimsScreen, DocumentsScreen, PoliciesScreen, PolicySheet } from './screens';
import { OverviewScreen } from './home';
// The assistant (and the markdown renderer it needs) loads on first use, keeping the first screen light
const AssistantView = lazy(() => import('./Assistant').then((mod) => ({ default: mod.AssistantView })));
import { DittoLogo, MascotAvatar, PersonAvatar, ThemeToggle, useMediaQuery, useTheme } from './ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LazyMotion, MotionConfig, m } from 'motion/react';
import { SPRING } from './motion';

const loadMotionFeatures = () => import('./motion-features').then((mod) => mod.default);

export type Tab = 'overview' | 'assistant' | 'policies' | 'claims' | 'documents';

const NAV: { id: Tab; label: string; icon?: LucideIcon }[] = [
  { id: 'overview', label: 'Home', icon: LayoutGrid },
  { id: 'assistant', label: 'Assistant' }, // shown with the mascot avatar
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'claims', label: 'Claims', icon: Receipt },
  { id: 'documents', label: 'Documents', icon: FileText },
];

export type AskRequest = { q: string; n: number } | null;

// ---------- URL ↔ state: every screen has an address, and Back closes what's open before leaving a screen ----------

const PATH: Record<Tab, string> = { overview: '/', assistant: '/assistant', policies: '/policies', claims: '/claims', documents: '/documents' };
const tabFromPath = (path: string): Tab => (Object.keys(PATH) as Tab[]).find((t) => PATH[t] === path.replace(/\/+$/, '') ) ?? 'overview';
const policyFromUrl = () => new URLSearchParams(window.location.search).get('policy');
type HistState = { app: true; idx: number };
const histIdx = () => ((window.history.state as HistState | null)?.app ? (window.history.state as HistState).idx : 0);
function push(url: string) { window.history.pushState({ app: true, idx: histIdx() + 1 } satisfies HistState, '', url); }
function replace(url: string) { window.history.replaceState({ app: true, idx: histIdx() } satisfies HistState, '', url); }
/** Plain left clicks navigate in place; modified clicks (new tab/window) are left to the browser. */
const isPlainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export default function App() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromPath(window.location.pathname));
  const [returnTab, setReturnTab] = useState<Tab>('overview');
  const [openPolicy, setOpenPolicy] = useState<Policy | null>(null);
  // The assistant keeps its conversation while people move between tabs, so it stays mounted once opened
  const [assistantMounted, setAssistantMounted] = useState(() => tabFromPath(window.location.pathname) === 'assistant');
  const [request, setRequest] = useState<AskRequest>(null);
  const wide = useMediaQuery('(min-width: 768px)');
  const [theme, toggleTheme] = useTheme();
  // The header shows its edge only once content scrolls under it
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  const tabRef = useRef(tab);
  tabRef.current = tab;
  const dataRef = useRef(data);
  dataRef.current = data;

  /** Switches screen (and records it in history unless `fromHistory`). */
  const showTab = useCallback((t: Tab, how: 'push' | 'replace' | 'none' = 'push') => {
    setOpenPolicy(null);
    if (t === 'assistant') setAssistantMounted(true);
    const current = tabRef.current;
    if (t === 'assistant' && current !== 'assistant') setReturnTab(current);
    if (how === 'push' && (t !== current || policyFromUrl())) push(PATH[t]);
    if (how === 'replace') replace(PATH[t]);
    setTab(t);
    window.scrollTo({ top: 0 });
  }, []);
  const goTo = useCallback((t: Tab) => showTab(t), [showTab]);

  /** Opens the assistant, optionally asking a question straight away. */
  const ask = useCallback((prompt?: string) => {
    // From an open policy sheet, the assistant replaces that history entry rather than stacking on it
    showTab('assistant', policyFromUrl() ? 'replace' : 'push');
    if (prompt) setRequest({ q: prompt, n: Date.now() });
  }, [showTab]);

  const openPolicySheet = useCallback((p: Policy) => {
    setOpenPolicy(p);
    push(`${PATH[tabRef.current]}?policy=${encodeURIComponent(p.id)}`);
  }, []);
  /** Closing anything we opened goes Back when possible, so the history stays honest. */
  const closePolicySheet = useCallback(() => {
    if (!policyFromUrl()) { setOpenPolicy(null); return; }
    if (histIdx() > 0) window.history.back();
    else { replace(PATH[tabRef.current]); setOpenPolicy(null); }
  }, []);
  const closeAssistant = useCallback(() => {
    if (histIdx() > 0) window.history.back();
    else showTab(returnTab === 'assistant' ? 'overview' : returnTab, 'replace');
  }, [returnTab, showTab]);

  // Back / Forward: the URL is the source of truth
  useEffect(() => {
    if (!(window.history.state as HistState | null)?.app) replace(window.location.pathname + window.location.search);
    const onPop = () => {
      const t = tabFromPath(window.location.pathname);
      showTab(t, 'none');
      const id = policyFromUrl();
      setOpenPolicy(id ? dataRef.current?.policies.find((x) => x.id === id) ?? null : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showTab]);

  // A policy in the URL (reload or shared link) opens once the data has loaded
  useEffect(() => {
    const id = policyFromUrl();
    if (data && id) setOpenPolicy(data.policies.find((x) => x.id === id) ?? null);
  }, [data]);

  // Shortcut: /?ask=your+question opens the assistant with that question (once; a reload won't ask again)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('ask');
    if (!q) return;
    replace('/');
    ask(q.slice(0, 1500));
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

        <header className="chrome-glass sticky top-0 z-30" {...(scrolled ? { 'data-scrolled': '' } : {})}>
          <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-4 px-4 md:h-20 md:px-6">
            <DittoLogo className="h-6 md:h-7" />

            {/* Tablet and desktop: pill navigation */}
            <nav aria-label="Main" className="mx-auto hidden md:block">
              <ul className="flex items-center gap-1 rounded-full bg-card p-1 shadow-card">
                {NAV.filter((t) => t.id !== 'assistant').map((t) => (
                  <li key={t.id}>
                    <a
                      href={PATH[t.id]}
                      onClick={(e) => { if (!isPlainClick(e)) return; e.preventDefault(); if (t.id === 'assistant') ask(); else goTo(t.id); }}
                      aria-current={tab === t.id ? 'page' : undefined}
                      {...(t.id === 'assistant' ? { 'data-ask-trigger': '' } : {})}
                      className="relative flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink-2 transition-colors duration-200 hover:text-ink aria-[current=page]:text-white dark:aria-[current=page]:text-accent-foreground lg:px-5"
                    >
                      {/* The highlight glides from the previous tab to this one */}
                      {tab === t.id && <m.span layoutId="nav-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-ink dark:bg-accent" aria-hidden="true" />}
                      <span className="relative flex items-center gap-2">
                        {t.id === 'assistant' && <MascotAvatar className="-ml-2 size-7" />}
                        {t.label}
                      </span>
                    </a>
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
          {data && tab !== 'assistant' && (
            <m.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16, ease: 'easeOut' }}>
          {tab === 'overview' && <OverviewScreen data={data} onOpenPolicy={openPolicySheet} onAsk={ask} onNavigate={goTo} />}
          {tab === 'policies' && <PoliciesScreen data={data} onOpenPolicy={openPolicySheet} onAsk={ask} />}
          {tab === 'claims' && <ClaimsScreen data={data} onAsk={ask} />}
          {tab === 'documents' && <DocumentsScreen data={data} />}
            </m.div>
          )}
          {data && assistantMounted && (
            <Suspense fallback={tab === 'assistant' ? <AssistantLoading /> : null}>
            <AssistantView
              data={data}
              active={tab === 'assistant'}
              wide={wide}
              request={request}
              firstName={first}
              onOpenPolicy={openPolicySheet}
              onClose={closeAssistant}
            />
            </Suspense>
          )}
        </main>

        {/* Tablet and desktop: the assistant lives in a floating Ask button, not in the nav */}
        {data && wide && tab !== 'assistant' && (
          <m.a
            href={PATH.assistant}
            onClick={(e) => { if (!isPlainClick(e)) return; e.preventDefault(); ask(); }}
            data-ask-trigger=""
            aria-label="Ask Ditto Assistant"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={SPRING}
            className="fixed bottom-6 right-6 z-40 flex h-14 items-center gap-2.5 rounded-full bg-primary py-1.5 pl-1.5 pr-5 text-[15px] font-semibold text-white shadow-float transition-colors hover:bg-primary-strong"
          >
            <MascotAvatar className="size-11 ring-2 ring-white/70" />
            Ask
          </m.a>
        )}

        {/* Phone: floating dark pill navigation with the assistant in the middle */}
        {data && (
          <nav aria-label="Main" className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-40 md:hidden">
            <ul className="nav-glass grid h-16 grid-cols-5 items-center rounded-full px-1.5">
              {(['overview', 'policies', 'assistant', 'claims', 'documents'] as const).map((id) => {
                const t = NAV.find((n) => n.id === id)!;
                const current = tab === id;
                if (id === 'assistant') {
                  return (
                    <li key={id} className="flex justify-center">
                      <m.a
                        href={PATH.assistant}
                        onClick={(e) => { if (!isPlainClick(e)) return; e.preventDefault(); ask(); }}
                        data-ask-trigger=""
                        aria-label="Ask a question"
                        aria-current={current ? 'page' : undefined}
                        whileTap={{ scale: 0.9 }}
                        transition={SPRING}
                        className="grid size-[52px] place-items-center rounded-full bg-primary p-[3px] shadow-float transition-colors hover:bg-primary-strong"
                      >
                        <MascotAvatar className="size-full" />
                      </m.a>
                    </li>
                  );
                }
                return (
                  <li key={id}>
                    <a
                      href={PATH[id]}
                      onClick={(e) => { if (!isPlainClick(e)) return; e.preventDefault(); goTo(id); }}
                      aria-current={current ? 'page' : undefined}
                      className={`relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-full text-[12px] font-medium transition-colors duration-200 ${current ? 'text-white' : 'text-white/60 hover:text-white'}`}
                    >
                      {current && <m.span layoutId="phone-nav-pill" transition={SPRING} className="absolute inset-x-0.5 inset-y-1 rounded-full bg-white/12" aria-hidden="true" />}
                      {t.icon && <t.icon className="relative size-5" strokeWidth={current ? 2.2 : 1.8} aria-hidden="true" />}
                      <span className="relative">{id === 'documents' ? 'Docs' : t.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        <PolicySheet policy={openPolicy} onClose={closePolicySheet} onAsk={ask} />
      </div>
    </TooltipProvider>
    </MotionConfig>
    </LazyMotion>
  );
}

function AssistantLoading() {
  return <div className="grid h-[60dvh] place-items-center" aria-busy="true" aria-label="Opening the assistant"><Skeleton className="h-12 w-64 rounded-full" /></div>;
}

function LoadingState() {
  return (
    // Invisible unless loading takes a moment, so a fast load starts from a clean, empty page
    <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.3 }} className="space-y-4 pt-4" aria-busy="true" aria-label="Loading your policies">
      <Skeleton className="h-10 w-48 rounded-full" />
      <Skeleton className="h-56 rounded-hero" />
      <div className="grid grid-cols-2 gap-3 @4xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-card" />)}
      </div>
    </m.div>
  );
}

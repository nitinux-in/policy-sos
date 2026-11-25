import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, LayoutGrid, MessageCircleQuestion, Receipt, Shield } from 'lucide-react';
import type { Policy, PortfolioData } from '../shared/types';
import { DEMO_TODAY, PRODUCT_NAME } from '../shared/demo';
import { ClaimsScreen, DocumentsScreen, OverviewScreen, PoliciesScreen, PolicySheet } from './screens';
import { Assistant, ASSISTANT_PANEL_ID } from './Assistant';
import { btn, ConceptTag, ThemeToggle, useMediaQuery, useTheme } from './ui';
import { fmtDate } from './lib';

export type Tab = 'overview' | 'policies' | 'claims' | 'documents';

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'claims', label: 'Claims', icon: Receipt },
  { id: 'documents', label: 'Documents', icon: FileText },
];

export const container = 'mx-auto w-full max-w-[1120px] px-4 sm:px-6';

export default function App() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [openPolicy, setOpenPolicy] = useState<Policy | null>(null);
  const [assistant, setAssistant] = useState<{ open: boolean; prompt?: string; key: number }>({ open: false, key: 0 });
  // From 1024px the companion docks beside the dashboard instead of covering it
  const docked = useMediaQuery('(min-width: 1024px)');
  const [theme, toggleTheme] = useTheme();

  // On tab change: name the page in the document title and move focus to its heading, so keyboard and
  // screen-reader users land at the start of the new content (skipped on first load).
  const prevTab = useRef(tab);
  useEffect(() => {
    const label = TABS.find((t) => t.id === tab)?.label ?? '';
    document.title = `${label} · ${PRODUCT_NAME} · Unofficial concept`;
    if (prevTab.current === tab) return;
    prevTab.current = tab;
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [tab]);

  const load = () => {
    setLoadError(null);
    fetch('/api/portfolio')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Server returned ${r.status}`))))
      .then(setData)
      .catch((e) => setLoadError(e.message || 'Could not reach the server'));
  };
  useEffect(load, []);

  // Demo shortcut: /?ask=your+question opens the companion with that question
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('ask');
    if (q) setAssistant((a) => ({ open: true, prompt: q.slice(0, 1500), key: a.key + 1 }));
  }, []);

  const ask = useCallback((prompt?: string) => {
    setOpenPolicy(null);
    setAssistant((a) => {
      // Already open and nothing new to ask: keep the conversation and just move focus to it
      if (a.open && !prompt) {
        requestAnimationFrame(() => document.getElementById(ASSISTANT_PANEL_ID)?.focus());
        return a;
      }
      return { open: true, prompt, key: a.key + 1 };
    });
  }, []);

  const goTo = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const sideBySide = assistant.open && docked;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-3">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className={`${container} flex h-16 items-center gap-4 ${sideBySide ? 'lg:ml-0 lg:max-w-[840px]' : ''}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white" aria-hidden="true">
              <MessageCircleQuestion size={19} strokeWidth={2} />
            </span>
            <div className="min-w-0 sm:flex sm:items-center sm:gap-2.5">
              <p className="truncate text-[15px] font-semibold tracking-tight">{PRODUCT_NAME}</p>
              <ConceptTag />
            </div>
          </div>

          <nav aria-label="Main" className="ml-auto hidden h-full md:block">
            <ul className="flex h-full items-stretch gap-1">
              {TABS.map((t) => (
                <li key={t.id} className="flex">
                  <button
                    type="button"
                    onClick={() => goTo(t.id)}
                    aria-current={tab === t.id ? 'page' : undefined}
                    className="focus-ring-inset border-b-2 border-transparent px-3 text-[15px] font-medium text-ink-2 transition-colors hover:text-ink aria-[current=page]:border-primary aria-[current=page]:text-ink"
                  >
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto md:ml-0">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          {data && !sideBySide && (
            <div className="hidden md:block">
              <button type="button" onClick={() => ask()} className={btn.primary} data-ask-trigger="">
                <MessageCircleQuestion size={18} aria-hidden="true" /> Ask the companion
              </button>
            </div>
          )}
        </div>
      </header>

      <div className={sideBySide ? 'mr-[440px]' : ''}>
        <main id="main" tabIndex={-1} className={`${container} pb-40 pt-6 outline-none md:pb-16 md:pt-10`}>
          {!data && !loadError && <LoadingState />}
          {loadError && (
            <div className="mx-auto max-w-md py-24 text-center" role="alert">
              <h1 className="text-[20px] font-bold">Couldn’t load the sample policies</h1>
              <p className="mt-2 text-ink-2">{loadError}. Make sure the app server is running, then try again.</p>
              <button type="button" onClick={load} className={`${btn.primary} mt-5`}>Try again</button>
            </div>
          )}
          {data && tab === 'overview' && <OverviewScreen data={data} onOpenPolicy={setOpenPolicy} onAsk={ask} />}
          {data && tab === 'policies' && <PoliciesScreen data={data} onOpenPolicy={setOpenPolicy} />}
          {data && tab === 'claims' && <ClaimsScreen data={data} onAsk={ask} />}
          {data && tab === 'documents' && <DocumentsScreen data={data} />}
          {data && <Disclosure />}
        </main>
      </div>

      {/* Phone: floating entry point to the companion. Stays mounted under the open companion so focus can return to it. */}
      {data && (
        <button
          type="button"
          onClick={() => ask()}
          tabIndex={assistant.open ? -1 : undefined}
          data-ask-trigger=""
          className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] right-4 z-20 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-semibold text-white shadow-float transition-colors hover:bg-primary-strong md:hidden"
        >
          <MessageCircleQuestion size={19} aria-hidden="true" /> Ask
        </button>
      )}

      {/* Phone: bottom tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-4">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => goTo(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`focus-ring-inset flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${active ? 'text-link' : 'text-ink-3'}`}
                >
                  <t.icon size={21} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {openPolicy && <PolicySheet policy={openPolicy} onClose={() => setOpenPolicy(null)} onAsk={ask} />}
      {assistant.open && data && (
        <Assistant
          key={assistant.key}
          data={data}
          initialPrompt={assistant.prompt}
          docked={docked}
          onClose={() => setAssistant((a) => ({ ...a, open: false }))}
        />
      )}
    </div>
  );
}

function Disclosure() {
  return (
    <footer className="mt-14 border-t border-line pt-6 text-[13px] leading-relaxed text-ink-3">
      <p>
        <span className="font-semibold text-ink-2">{PRODUCT_NAME} is an unofficial design concept.</span> It is not made,
        endorsed or operated by Ditto. Policies, insurers, people and claims shown are sample data, not real contracts.
        Answers come from local rules applied to this sample data — not a live AI — and are guidance only. An insurer makes
        the final decision on any claim.
      </p>
      <p className="mt-2">Demo date: {fmtDate(DEMO_TODAY)}</p>
    </footer>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading sample policies">
      <div className="h-8 w-2/3 max-w-sm animate-pulse rounded-lg bg-line-2" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="h-48 animate-pulse rounded-2xl bg-line-2" />)}
      </div>
    </div>
  );
}

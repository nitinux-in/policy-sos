import { useEffect, useState } from 'react';
import { FileText, LayoutGrid, Receipt, Shield, Sparkles } from 'lucide-react';
import type { Policy, PortfolioData } from '../shared/types';
import { ClaimsScreen, DocumentsScreen, OverviewScreen, PoliciesScreen, PolicySheet } from './screens';
import { Assistant } from './Assistant';

export type Tab = 'overview' | 'policies' | 'claims' | 'documents';

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'claims', label: 'Claims', icon: Receipt },
  { id: 'documents', label: 'Documents', icon: FileText },
];

export default function App() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [openPolicy, setOpenPolicy] = useState<Policy | null>(null);
  const [assistant, setAssistant] = useState<{ open: boolean; prompt?: string; key: number }>({ open: false, key: 0 });

  const load = () => {
    setLoadError(null);
    fetch('/api/portfolio')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Server returned ${r.status}`))))
      .then(setData)
      .catch((e) => setLoadError(e.message || 'Could not reach the server'));
  };
  useEffect(load, []);

  // Demo shortcut: /?ask=your+question opens the assistant with that question
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('ask');
    if (q) setAssistant((a) => ({ open: true, prompt: q.slice(0, 1500), key: a.key + 1 }));
  }, []);

  const ask = (prompt?: string) => {
    setOpenPolicy(null);
    setAssistant((a) => ({ open: true, prompt, key: a.key + 1 }));
  };

  return (
    <div className="min-h-full w-full sm:flex sm:items-center sm:justify-center sm:py-6">
      {/* Phone frame on larger screens; full-screen on phones */}
      <div className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-canvas sm:h-[880px] sm:max-h-[calc(100dvh-3rem)] sm:rounded-[40px] sm:border sm:border-line sm:shadow-[0_30px_80px_-30px_rgba(28,27,31,0.35)]">
        <main className="no-scrollbar flex-1 overflow-y-auto pb-28">
          {!data && !loadError && <LoadingState />}
          {loadError && (
            <div className="p-6 pt-24 text-center">
              <p className="text-[15px] font-semibold">Couldn't load your portfolio</p>
              <p className="mt-1 text-sm text-ink-2">{loadError}. Make sure the app server is running.</p>
              <button onClick={load} className="mt-4 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">Try again</button>
            </div>
          )}
          {data && tab === 'overview' && <OverviewScreen data={data} onOpenPolicy={setOpenPolicy} onAsk={ask} onTab={setTab} />}
          {data && tab === 'policies' && <PoliciesScreen data={data} onOpenPolicy={setOpenPolicy} />}
          {data && tab === 'claims' && <ClaimsScreen data={data} onAsk={ask} />}
          {data && tab === 'documents' && <DocumentsScreen data={data} />}
        </main>

        {/* Floating assistant entry point */}
        {data && !assistant.open && (
          <button
            onClick={() => ask()}
            className="absolute bottom-[84px] right-4 z-20 flex items-center gap-2 rounded-full bg-violet py-3 pl-3.5 pr-4 text-[14px] font-semibold text-white shadow-[0_10px_30px_-8px_rgba(91,46,255,0.6)] active:scale-[0.97]"
            aria-label="Open Policy SOS assistant"
          >
            <Sparkles size={18} /> Ask Policy SOS
          </button>
        )}

        {/* Bottom navigation */}
        <nav className="absolute inset-x-0 bottom-0 z-10 border-t border-line bg-canvas/95 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur">
          <ul className="grid grid-cols-4">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setTab(t.id)}
                    className={`flex w-full flex-col items-center gap-1 py-1 text-[11px] font-medium ${active ? 'text-ink' : 'text-ink-3'}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <t.icon size={20} strokeWidth={active ? 2.2 : 1.8} className={active ? 'text-violet' : ''} />
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
            onClose={() => setAssistant((a) => ({ ...a, open: false }))}
          />
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 p-5 pt-16" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-line-2" />
      ))}
    </div>
  );
}

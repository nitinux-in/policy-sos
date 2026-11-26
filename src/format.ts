import { HeartPulse, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { AgentAnswer, AgentStep, Category, Policy, StreamEvent } from '../shared/types';
import { DEMO_TODAY, type ActiveCategory } from '../shared/demo';

export const CATEGORY: Record<ActiveCategory, { label: string; icon: LucideIcon; coverLabel: string }> = {
  health: { label: 'Health', icon: HeartPulse, coverLabel: 'Sum insured' },
  life: { label: 'Term life', icon: ShieldCheck, coverLabel: 'Life cover' },
};

/** Category display info. Only active categories ever reach the app (the server scopes the data). */
export function categoryMeta(c: Category) {
  return CATEGORY[c as ActiveCategory] ?? CATEGORY.health;
}

export function fmtMoney(p: Pick<Policy, 'currency'>, n: number, compact = false): string {
  if (p.currency === 'USD') return `US$${n.toLocaleString('en-US')}`;
  if (compact) {
    if (n >= 1e7) return `₹${+(n / 1e7).toFixed(2)} Cr`;
    if (n >= 1e5) return `₹${+(n / 1e5).toFixed(1)} L`;
  }
  return `₹${n.toLocaleString('en-IN')}`;
}

export function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Days from the fixed demo date (not the real clock), so outputs never drift. */
export function daysUntil(iso: string): number {
  const today = new Date(DEMO_TODAY + 'T00:00:00');
  return Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86400000);
}

export type PolicyStatus = { kind: 'active' | 'renewing' | 'expired' | 'lapsed'; label: string };

export function policyStatus(p: Policy): PolicyStatus {
  const d = daysUntil(p.renewalDate);
  if (p.status === 'lapsed') return { kind: 'lapsed', label: 'Lapsed' };
  if (d < 0) return { kind: 'expired', label: 'Expired' };
  if (p.status === 'expiring_soon' || d <= 30) return { kind: 'renewing', label: d === 0 ? 'Renews today' : `Renews in ${d} days` };
  return { kind: 'active', label: 'Active' };
}

/** Sends a message to the local demo engine and streams its tool steps as they run. */
export async function askAgent(
  message: string,
  onStep: (s: AgentStep) => void,
  signal?: AbortSignal,
): Promise<AgentAnswer> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error (${res.status})`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final: AgentAnswer | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as StreamEvent;
      if (ev.type === 'step') onStep(ev.step);
      else if (ev.type === 'final') final = ev.answer;
      else if (ev.type === 'error') throw new Error(ev.message);
    }
  }
  if (!final) throw new Error('The answer was interrupted. Please try again.');
  return final;
}

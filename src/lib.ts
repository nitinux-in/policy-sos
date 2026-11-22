import { Car, HeartPulse, Home, Plane, ShieldCheck, Activity, type LucideIcon } from 'lucide-react';
import type { AgentAnswer, AgentStep, Category, ChatTurn, Policy, StreamEvent } from '../shared/types';

export const CATEGORY: Record<Category, { label: string; icon: LucideIcon; tint: string }> = {
  health: { label: 'Health', icon: HeartPulse, tint: 'bg-rose-50 text-rose-700' },
  life: { label: 'Term life', icon: ShieldCheck, tint: 'bg-emerald-50 text-emerald-700' },
  motor: { label: 'Motor', icon: Car, tint: 'bg-sky-50 text-sky-700' },
  travel: { label: 'Travel', icon: Plane, tint: 'bg-amber-50 text-amber-700' },
  home: { label: 'Home', icon: Home, tint: 'bg-stone-100 text-stone-700' },
  accident: { label: 'Accident', icon: Activity, tint: 'bg-orange-50 text-orange-700' },
};

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

export function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86400000);
}

/** Sends a message to the agent and streams step events as they happen. */
export async function askAgent(
  message: string,
  history: ChatTurn[],
  onStep: (s: AgentStep) => void,
  signal?: AbortSignal,
): Promise<AgentAnswer> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
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

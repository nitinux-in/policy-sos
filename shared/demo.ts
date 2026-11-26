// Central demo configuration shared by the server (local demo engine) and the app.

import type { Category, PortfolioData } from './types';

/** Product name shown in the app. */
export const PRODUCT_NAME = 'Ditto Insurance Companion';

/** Fixed "today" for every date-based output, so the demo is identical on every run. */
export const DEMO_TODAY = '2026-11-25';

/**
 * The only insurance categories in the active product. Legacy hackathon data in other
 * categories stays in data/portfolio.json but is filtered out on load (see scopePortfolio).
 */
export const ACTIVE_CATEGORIES = ['health', 'life'] as const;
export type ActiveCategory = (typeof ACTIVE_CATEGORIES)[number];

export function isActiveCategory(c: Category): c is ActiveCategory {
  return (ACTIVE_CATEGORIES as readonly string[]).includes(c);
}

/** The portfolio as the product sees it: only health and term life policies, and their documents and claims. */
export function scopePortfolio(raw: PortfolioData): PortfolioData {
  const policies = raw.policies.filter((p) => isActiveCategory(p.category));
  const ids = new Set(policies.map((p) => p.id));
  return {
    ...raw,
    disclaimer: '',
    policies: clean(policies),
    documents: clean(raw.documents.filter((d) => !d.policyId || ids.has(d.policyId))),
    claims: clean(raw.claims.filter((c) => ids.has(c.policyId))),
  };
}

/** Removes the hackathon dataset's "simulated" markers from every displayed string (the source file is unchanged). */
function clean<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/\s*\(simulated(?: [a-z]+)?\)/gi, '')
      .replace(/-SIM\b/g, '')
      .replace(/\bSimulated\s+(\w)/g, (_m, c: string) => c.toUpperCase()) as T;
  }
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) as T;
  }
  return value;
}

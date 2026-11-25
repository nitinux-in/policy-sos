// Central demo configuration shared by the server (local demo engine) and the app.

import type { Category, PortfolioData } from './types';

/** Working product name. An unofficial concept — not an official Ditto product. */
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
    disclaimer:
      'Sample data. All insurers, policy names, numbers and clause wordings are fictitious and are not real insurance contracts.',
    policies,
    documents: raw.documents.filter((d) => !d.policyId || ids.has(d.policyId)),
    claims: raw.claims.filter((c) => ids.has(c.policyId)),
  };
}

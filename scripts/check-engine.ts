// Regression check for the deterministic local demo engine.
//
//   npm run check:engine              compare every case against the saved snapshot
//   npm run check:engine -- --update  rewrite the snapshot (review the diff before committing)
//
// Besides the snapshot, it checks the answer contract on every case:
//   - identical answer on two runs (deterministic) and no network request while answering
//   - no out-of-scope policy (motor, travel, home, personal accident) in any answer
//   - every answer has a one-sentence headline; at most 4 key points; the body text stays short
//   - emergencies happening now carry the one-line 112 notice; people already in care get no safety notice
//   - coverage and claim questions carry confidence factors, and the confidence level follows the documented rule
//   - every tool step shown is a real tool (no invented "thinking" steps)
//   - every follow-up suggestion is itself a question the engine answers (not a fallback or clarification)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AgentAnswer, ConfidenceLevel } from '../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(here, 'engine-cases.json');
const SNAPSHOT = path.join(here, 'engine-snapshot.json');
const update = process.argv.includes('--update');

// Any network request during an answer is a failure: the engine must be fully local.
let networkCalls = 0;
globalThis.fetch = (async (input: unknown) => {
  networkCalls++;
  throw new Error(`Network request attempted: ${String(input)}`);
}) as typeof fetch;

const { runAgent } = await import('../server/agent.js');
const { TOOL_LABELS } = await import('../server/tools.js');
const { prompts, emergencyNow, inCare, factors } = JSON.parse(readFileSync(CASES, 'utf8')) as { prompts: string[]; emergencyNow: string[]; inCare: string[]; factors: string[] };

/** The parts of an answer a person sees, in a stable, reviewable shape. */
function summarise(a: AgentAnswer) {
  return {
    route: a.steps.map((s) => (s.tool === 'resolveIntent' ? `intent:${s.detail}` : s.tool)).join(' > '),
    headline: a.headline,
    verdict: a.verdict,
    keyPoints: a.keyPoints,
    confidence: a.confidence ? `${a.confidence.level} · ${a.confidence.label} · ${a.confidence.reason}` : undefined,
    factors: a.confidence?.factors.map((f) => `${f.status}${f.impact ? `/${f.impact}` : ''} ${f.id}: ${f.summary}${f.clauseIds?.length ? ` [${f.clauseIds.join(', ')}]` : ''}`),
    details: a.details?.map((d) => d.id),
    text: a.text || undefined,
    coverage: a.coverage.map((c) => `${c.policyId} ${c.status}: ${c.reasoning}`),
    cost: a.cost?.map((c) => (c.sufficientData ? `${c.policyId} out-of-pocket ${c.estimatedOutOfPocket}` : `${c.policyId} needs: ${c.missing.join('; ')}`)),
    comparison: a.comparison ? `${a.comparison.policies.map((p) => p.policyId).join(' vs ')} × ${a.comparison.rows.length} rows` : undefined,
    plan: a.plan?.steps.map((s) => s.text),
    evidence: a.evidence.map((e) => e.clauseId),
    safetyNotice: a.safetyNotice,
    untrustedNotice: a.untrustedNotice ? true : undefined,
    suggestions: a.suggestions,
  };
}

/** The documented confidence rule (server/confidence.ts), recomputed independently. */
function expectedLevel(a: AgentAnswer): ConfidenceLevel | undefined {
  const c = a.confidence;
  if (!c) return undefined;
  const blockers = c.factors.filter((f) => f.status === 'risk' && f.impact !== 'reduces').length;
  const unknowns = c.factors.filter((f) => f.status === 'unknown').length;
  const open = c.factors.filter((f) => f.status === 'check').length + unknowns;
  const positive = ['yes', 'likely', 'partial', 'depends'].includes(a.verdict ?? '');
  if (positive) return blockers || unknowns >= 2 ? 'low' : open ? 'medium' : 'high';
  return open ? 'medium' : 'high';
}

const REAL_STEPS = new Set([...Object.keys(TOOL_LABELS), 'resolveIntent', 'guardrail']);
const FALLBACK_ROUTES = /intent:(Not an insurance question|Needs one detail|Follow-up without context|Outside health and term life|Not supported)|Unclear input|Unreadable input/;
const OUT_OF_SCOPE_IDS = /\b(MTR|TRV|HOM|PA)-\d+/;
const failures: string[] = [];
const results: Record<string, ReturnType<typeof summarise>> = {};
const suggestions = new Set<string>();

for (const prompt of prompts) {
  const answer = await runAgent(prompt, () => {});
  const first = summarise(answer);
  const second = summarise(await runAgent(prompt, () => {}));
  const json = JSON.stringify(first);
  const fail = (msg: string) => failures.push(`${msg}: "${prompt}"`);
  if (json !== JSON.stringify(second)) fail('Not deterministic');
  if (OUT_OF_SCOPE_IDS.test(json)) fail('Out-of-scope policy in answer');
  if (!answer.headline?.trim()) fail('Missing headline');
  if ((answer.keyPoints?.length ?? 0) > 4) fail('More than 4 key points');
  if (answer.keyPoints?.some((k) => !k.trim() || /\*\*/.test(k))) fail('Empty or markdown key point');
  if (answer.text.length > 300) fail(`Body text too long (${answer.text.length} chars)`);
  if (answer.steps.some((s) => !REAL_STEPS.has(s.tool))) fail('Step that is not a real tool');
  if (emergencyNow.includes(prompt) && !answer.safetyNotice?.includes('112')) fail('Missing one-line 112 notice');
  if (emergencyNow.includes(prompt) && (answer.safetyNotice?.split(/(?<=\.)\s/).length ?? 0) > 2) fail('Safety notice longer than one line');
  if (inCare.includes(prompt) && answer.safetyNotice) fail('Safety notice shown to someone already in care');
  if (inCare.includes(prompt) && answer.plan?.steps.some((s) => /112/.test(s.text))) fail('“Call 112” step for someone already in care');
  if (factors.includes(prompt) && !answer.confidence?.factors.length) fail('Missing confidence factors');
  if (answer.confidence && answer.confidence.level !== expectedLevel(answer)) fail(`Confidence ${answer.confidence.level} breaks the rule (expected ${expectedLevel(answer)})`);
  if (answer.confidence?.factors.some((f) => !f.summary.trim())) fail('Factor without a summary');
  if ((answer.suggestions?.length ?? 0) > 3) fail('More than 3 suggestions');
  for (const q of answer.suggestions ?? []) suggestions.add(q);
  results[prompt] = first;
}

// Every follow-up the engine offers must itself be answered (not a fallback or clarification)
for (const q of suggestions) {
  const route = summarise(await runAgent(q, () => {})).route;
  if (FALLBACK_ROUTES.test(route)) failures.push(`Suggestion isn’t answered (${route}): "${q}"`);
}
if (networkCalls) failures.push(`${networkCalls} network request(s) attempted`);

if (update) {
  writeFileSync(SNAPSHOT, JSON.stringify(results, null, 2) + '\n');
  console.log(`Snapshot updated: ${prompts.length} cases.`);
} else if (!existsSync(SNAPSHOT)) {
  failures.push('No snapshot yet — run `npm run check:engine -- --update` first.');
} else {
  const saved = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, unknown>;
  for (const prompt of prompts) {
    if (!(prompt in saved)) failures.push(`New case without snapshot: "${prompt}"`);
    else if (JSON.stringify(saved[prompt]) !== JSON.stringify(results[prompt])) failures.push(`Answer changed: "${prompt}"`);
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${prompts.length} cases (+${suggestions.size} follow-up suggestions): deterministic, headline and ≤4 key points, confidence rule holds, emergency notices only when needed, real tool steps, no network requests${update ? '' : ', match snapshot'}.`);

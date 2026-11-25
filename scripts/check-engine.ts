// Regression check for the deterministic local demo engine.
//
//   npm run check:engine              compare every case against the saved snapshot
//   npm run check:engine -- --update  rewrite the snapshot (review the diff before committing)
//
// It also verifies that each answer is identical across two runs, that no out-of-scope policy
// (motor, travel, home, personal accident) ever appears, that emergency prompts carry the
// urgent-care notice, and that the engine makes no network requests while answering.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AgentAnswer } from '../shared/types.js';

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
const { prompts, emergency } = JSON.parse(readFileSync(CASES, 'utf8')) as { prompts: string[]; emergency: string[] };

/** The parts of an answer a person sees, in a stable, reviewable shape. */
function summarise(a: AgentAnswer) {
  return {
    route: a.steps.map((s) => (s.tool === 'resolveIntent' ? `intent:${s.detail}` : s.tool)).join(' > '),
    text: a.text,
    coverage: a.coverage.map((c) => `${c.policyId} ${c.status}: ${c.reasoning}`),
    unknowns: a.coverage.flatMap((c) => c.unknowns.filter((u) => !u.startsWith('Final decision'))),
    cost: a.cost?.map((c) => (c.sufficientData ? `${c.policyId} out-of-pocket ${c.estimatedOutOfPocket}` : `${c.policyId} needs: ${c.missing.join('; ')}`)),
    comparison: a.comparison ? `${a.comparison.policies.map((p) => p.policyId).join(' vs ')} × ${a.comparison.rows.length} rows` : undefined,
    plan: a.plan?.steps.map((s) => s.text),
    evidence: a.evidence.map((e) => e.clauseId),
    safetyNotice: a.safetyNotice,
    suggestions: a.suggestions?.length,
  };
}

const OUT_OF_SCOPE_IDS = /\b(MTR|TRV|HOM|PA)-\d+/;
const failures: string[] = [];
const results: Record<string, ReturnType<typeof summarise>> = {};

for (const prompt of prompts) {
  const first = summarise(await runAgent(prompt, () => {}));
  const second = summarise(await runAgent(prompt, () => {}));
  const a = JSON.stringify(first);
  if (a !== JSON.stringify(second)) failures.push(`Not deterministic: "${prompt}"`);
  if (OUT_OF_SCOPE_IDS.test(a)) failures.push(`Out-of-scope policy in answer: "${prompt}"`);
  if (emergency.includes(prompt) && !first.safetyNotice?.includes('112')) failures.push(`Missing urgent-care notice: "${prompt}"`);
  results[prompt] = first;
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
console.log(`✓ ${prompts.length} cases: deterministic, in scope, emergency notices present, no network requests${update ? '' : ', match snapshot'}.`);

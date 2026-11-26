// Checks for the home dashboard insights (shared/insights.ts).
//
//   npm run check:insights
//
// Runs the insight functions on the demo portfolio and on a few variations (other dates, a used-up sum insured,
// a family member with no health cover, a portfolio with nothing to do) and checks:
//   - identical output on two runs (deterministic), and no network request
//   - shapes and limits: ≤4 attention items sorted by urgency, 3–5 things to know with titles of ≤6 words,
//     one-line details, unique ids, "All clear" (empty list) when nothing needs doing
//   - every policyId / clauseId exists, and each clause belongs to its policy
//   - the coverage matrix matches the insured lists and the term nominee
//   - the summary figures match the engine's "sum insured left" answer
//   - copy follows docs/voice-and-copy.md basics (no banned words, no exclamation marks, no "·" in sentences)
//   - every prompt (things to know + "ask" actions) gets a real, on-topic answer from the local engine:
//     not a fallback or clarification, and citing the clause the item relies on

import type { PortfolioData } from '../shared/types.js';

let networkCalls = 0;
globalThis.fetch = (async (input: unknown) => {
  networkCalls++;
  throw new Error(`Network request attempted: ${String(input)}`);
}) as typeof fetch;

const { runAgent } = await import('../server/agent.js');
const { portfolio } = await import('../server/tools.js');
const { DEMO_TODAY } = await import('../shared/demo.js');
const I = await import('../shared/insights.js');

const failures: string[] = [];
const fail = (where: string, msg: string) => failures.push(`[${where}] ${msg}`);
const clone = (d: PortfolioData): PortfolioData => JSON.parse(JSON.stringify(d));

const TONES = ['bad', 'warn', 'info'];
const BANNED = /\b(simply|just|please note|kindly|rest assured|hassle-free|seamless|AI-powered|smart|intimate|admissible|arrears)\b|!/i;
const FALLBACK_ROUTES = /^(Not an insurance question|Needs one detail|Follow-up without context|Outside health and term life|Not supported|Greeting)$/;

// ---------- scenarios ----------

const noFather = clone(portfolio);
for (const p of noFather.policies) p.insured = p.insured.filter((e) => !/\(father\)/.test(e));
const allClear = clone(noFather);
for (const d of allClear.documents) d.trusted = true;
const usedUp = clone(portfolio);
const floater = usedUp.policies.find((p) => p.id === 'HLT-01')!;
usedUp.claims.push({ id: 'CLM-TEST', policyId: floater.id, title: 'Test claim', date: floater.startDate, status: 'settled', amountClaimed: floater.sumInsured * 0.8, amountSettled: floater.sumInsured * 0.8 });
const spouseUncovered = clone(portfolio);
for (const p of spouseUncovered.policies.filter((x) => x.category === 'health')) p.insured = p.insured.filter((e) => !/\(spouse\)/.test(e));

const scenarios: { name: string; data: PortfolioData; today: string; expectEmpty?: boolean }[] = [
  { name: 'demo', data: portfolio, today: DEMO_TODAY },
  { name: 'employer renewal close', data: portfolio, today: '2027-03-20' },
  { name: 'floater renewal + port deadline + wait ending', data: portfolio, today: '2027-05-10' },
  { name: 'floater in grace, term renewal close', data: portfolio, today: '2027-07-10' },
  { name: 'term premium overdue', data: portfolio, today: '2027-08-20' },
  { name: 'sum insured used up', data: usedUp, today: DEMO_TODAY },
  { name: 'spouse not on health cover', data: spouseUncovered, today: DEMO_TODAY },
  { name: 'all clear', data: allClear, today: '2026-08-01', expectEmpty: true },
];

/** prompt → the clause ids the answer should cite (any one is enough) and where it came from */
const prompts = new Map<string, { clauses: string[]; from: string }>();

for (const { name, data, today, expectEmpty } of scenarios) {
  const policies = new Map(data.policies.map((p) => [p.id, p]));
  const clauseIn = (policyId: string, clauseId: string) => !!policies.get(policyId)?.clauses.some((c) => c.id === clauseId);
  const anyClause = (clauseId: string) => data.policies.some((p) => p.clauses.some((c) => c.id === clauseId));
  const copy = (where: string, s: string, label: string) => {
    if (!s.trim()) fail(where, `empty ${label}`);
    if (/\n/.test(s)) fail(where, `${label} is not one line: "${s}"`);
    if (BANNED.test(s)) fail(where, `${label} breaks the voice guide: "${s}"`);
    if (/ · /.test(s)) fail(where, `"·" in a sentence: "${s}"`);
  };

  // Determinism
  const run = () => JSON.stringify([I.needsAttention(data, today), I.thingsToKnow(data, today), I.coverageMatrix(data), I.summaryFigures(data, today)]);
  if (run() !== run()) fail(name, 'not deterministic');

  // 1. Needs attention
  const att = I.needsAttention(data, today);
  if (att.length > 4) fail(name, `${att.length} attention items (max 4)`);
  if (expectEmpty && att.length) fail(name, `expected "All clear", got: ${att.map((a) => a.id).join(', ')}`);
  if (!expectEmpty && !att.length) fail(name, 'expected at least one attention item');
  if (new Set(att.map((a) => a.id)).size !== att.length) fail(name, 'duplicate attention ids');
  att.forEach((a, i) => {
    const where = `${name} · attention ${a.id}`;
    if (!TONES.includes(a.tone)) fail(where, `bad tone ${a.tone}`);
    if (i && TONES.indexOf(att[i - 1].tone) > TONES.indexOf(a.tone)) fail(where, 'not sorted by urgency');
    copy(where, a.title, 'title');
    copy(where, a.detail, 'detail');
    copy(where, a.actionLabel, 'action label');
    if (/\.$/.test(a.actionLabel)) fail(where, 'button label ends with a full stop');
    if (a.policyId && !policies.has(a.policyId)) fail(where, `unknown policy ${a.policyId}`);
    if (a.clauseId && (!a.policyId || !clauseIn(a.policyId, a.clauseId))) fail(where, `clause ${a.clauseId} not in policy ${a.policyId}`);
    if (a.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) fail(where, `bad due date ${a.dueDate}`);
    if (a.action.kind === 'policy' && !policies.has(a.action.policyId)) fail(where, `action opens unknown policy ${a.action.policyId}`);
    if (a.action.kind === 'documents' && !data.documents.length) fail(where, 'documents action with no documents');
    if (a.action.kind === 'ask') {
      copy(where, a.action.prompt, 'prompt');
      const prev = prompts.get(a.action.prompt);
      prompts.set(a.action.prompt, { clauses: [...new Set([...(prev?.clauses ?? []), ...(a.clauseId ? [a.clauseId] : [])])], from: prev?.from ?? where });
    }
  });

  // 3. Things to know
  const things = I.thingsToKnow(data, today);
  if (things.length < 3 || things.length > 5) fail(name, `${things.length} things to know (want 3–5)`);
  if (new Set(things.map((t) => t.id)).size !== things.length) fail(name, 'duplicate insight ids');
  for (const t of things) {
    const where = `${name} · know ${t.id}`;
    copy(where, t.title, 'title');
    copy(where, t.detail, 'detail');
    copy(where, t.prompt, 'prompt');
    if (t.title.split(/\s+/).length > 6) fail(where, `title over 6 words: "${t.title}"`);
    if (/\.$/.test(t.title)) fail(where, 'title ends with a full stop');
    if (t.detail.length > 140) fail(where, `detail too long (${t.detail.length} chars)`);
    if (!t.prompt.endsWith('?')) fail(where, 'prompt is not a question');
    if (!clauseIn(t.policyId, t.clauseId)) fail(where, `clause ${t.clauseId} not in policy ${t.policyId}`);
    for (const c of t.relatedClauseIds ?? []) if (!anyClause(c)) fail(where, `unknown related clause ${c}`);
    prompts.set(t.prompt, { clauses: [t.clauseId, ...(t.relatedClauseIds ?? [])], from: where });
  }

  // 2. Coverage matrix
  const m = I.coverageMatrix(data);
  if (m.policies.map((p) => p.id).join() !== data.policies.filter((p) => p.category === 'health').concat(data.policies.filter((p) => p.category === 'life')).map((p) => p.id).join()) fail(name, 'matrix policies differ from the portfolio');
  if (new Set(m.people.map((p) => p.key)).size !== m.people.length) fail(name, 'duplicate people in matrix');
  if (m.people[0]?.relation !== 'You') fail(name, 'matrix does not start with you');
  for (const person of m.people) {
    for (const p of m.policies) {
      const cell = m.cells[person.key]?.[p.id];
      if (!cell) { fail(name, `missing cell ${person.key} × ${p.id}`); continue; }
      const insured = policies.get(p.id)!.insured.some((e) => e.startsWith(`${person.name} (`) || e === person.name);
      if (cell.covered !== insured) fail(name, `${person.name} × ${p.id}: covered=${cell.covered} but insured list says ${insured}`);
    }
  }
  for (const p of data.policies) for (const e of p.insured) {
    const nm = e.replace(/\s*\(.*\)$/, '');
    if (!m.people.some((x) => x.name === nm)) fail(name, `insured person missing from matrix: ${e}`);
  }
  for (const p of data.policies.filter((x) => x.category === 'life')) {
    const nominee = p.keyFacts.find((f) => f.label === 'Nominee')?.value;
    const row = m.people.find((x) => x.name === nominee);
    if (nominee && m.cells[row?.key ?? '']?.[p.id]?.note !== 'Nominee') fail(name, `nominee ${nominee} not marked on ${p.id}`);
  }

  // 4. Summary figures
  const s = I.summaryFigures(data, today);
  if (!(s.healthCoverLeft >= 0 && s.healthCoverLeft <= s.healthCoverTotal)) fail(name, `health cover left ${s.healthCoverLeft} outside 0–${s.healthCoverTotal}`);
  if (s.lifeCover <= 0) fail(name, 'no life cover');
}

// Demo figures agree with the engine's own "sum insured left" answer
{
  const s = I.summaryFigures(portfolio, DEMO_TODAY);
  const a = await runAgent('How much sum insured is left?', () => {});
  if (!a.headline?.includes(I.formatInr(s.healthCoverLeft))) fail('summary', `engine says "${a.headline}", insights say ${I.formatInr(s.healthCoverLeft)}`);
  const settled = portfolio.claims.filter((c) => c.status === 'settled').reduce((x, c) => x + (c.amountSettled ?? 0), 0);
  if (s.claimedBack !== settled) fail('summary', `claimed back ${s.claimedBack} ≠ ${settled}`);
}

// Every prompt is answered on topic by the local engine
for (const [prompt, { clauses, from }] of prompts) {
  const run = async () => {
    const a = await runAgent(prompt, () => {});
    const route = a.steps.find((x) => x.tool === 'resolveIntent')?.detail ?? a.steps.map((x) => x.tool).join(' > ');
    const cited = new Set([...a.evidence.map((e) => e.clauseId), ...(a.confidence?.factors ?? []).flatMap((f) => f.clauseIds ?? [])]);
    return { a, route, cited };
  };
  const first = await run();
  const second = await run();
  if (JSON.stringify(first.a) !== JSON.stringify(second.a)) fail(from, `engine answer not deterministic: "${prompt}"`);
  if (FALLBACK_ROUTES.test(first.route) || first.a.steps.some((x) => x.tool === 'guardrail')) fail(from, `prompt not answered (${first.route}): "${prompt}"`);
  if (!first.a.headline?.trim()) fail(from, `no headline for "${prompt}"`);
  if (clauses.length && !clauses.some((c) => first.cited.has(c))) fail(from, `answer to "${prompt}" doesn’t cite ${clauses.join(' or ')} (route ${first.route}, cites ${[...first.cited].join(', ')})`);
  if (!clauses.length && !/^(Health|Term life): /.test(first.route)) fail(from, `"${prompt}" routes to a generic answer (${first.route})`);
}

if (networkCalls) failures.push(`${networkCalls} network request(s) attempted`);

if (failures.length) {
  console.error(`✗ ${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${scenarios.length} scenarios, ${prompts.size} prompts: deterministic, shapes and limits hold, every policy/clause exists, matrix matches insured lists, figures match the engine, every prompt answered on topic, no network requests.`);

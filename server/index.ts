import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runAgent } from './agent.js';
import { portfolio } from './tools.js';
import type { StreamEvent } from '../shared/types.js';

const app = express();
app.use(express.json({ limit: '64kb' }));

// All answers come from the local deterministic demo engine — no AI provider is called.
app.get('/api/health', (_req, res) => res.json({ ok: true, engine: 'local-demo' }));

// Portfolio data for the dashboard (same data the tools use, so cards and answers stay consistent)
app.get('/api/portfolio', (_req, res) => res.json(portfolio));

const ChatBody = z.object({
  message: z.string().trim().min(1, 'Message is empty').max(1500, 'Message is too long (max 1500 characters)'),
});

// Simple rate limit: 20 messages per minute per device
const hits = new Map<string, number[]>();
app.post('/api/chat', async (req, res) => {
  const ip = req.ip ?? 'x';
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) { res.status(429).json({ error: 'Too many messages. Please wait a minute.' }); return; }
  hits.set(ip, [...recent, now]);
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (e: StreamEvent) => res.write(JSON.stringify(e) + '\n');
  try {
    const answer = await runAgent(parsed.data.message, (step) => send({ type: 'step', step }));
    send({ type: 'final', answer });
  } catch (e) {
    console.error('[chat] failed', e);
    send({ type: 'error', message: 'Something went wrong while preparing the answer. Please try again.' });
  }
  res.end();
});

// In production, serve the built app
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', 'dist');
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html'), (err) => err && res.status(404).end()));

const port = Number(process.env.PORT) || 8787;
app.listen(port, '0.0.0.0', () => {
  console.log(`Ditto Insurance Companion API on http://localhost:${port} — local rule-based engine, no external AI`);
});

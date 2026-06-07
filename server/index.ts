/// <reference types="node" />
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import {
  ClutterFindingSchema,
  DecisionSchema,
  EmailCandidateSchema,
  UserPreferenceSchema,
} from '../src/schemas/index.js';
import { runAgentClassification, runAgentChat, initServerWeave, weaveDashboardUrl } from './agents.js';
import { cacheStatus, initCache } from './cache.js';
import type { SseWriter } from './trace-bridge.js';

const PORT = Number(process.env['EMAIL_SIGNAL_PORT'] ?? 3030);

const app = new Hono();

// CORS: allow any chrome-extension://... origin. In production tighten this to
// the specific extension ID.
app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  })
);

// ---- Health ----
app.get('/health', (c) =>
  c.json({
    ok: true,
    name: 'emailsignal-server',
    version: '0.1.0',
    hasOpenAIKey: !!process.env['OPENAI_API_KEY'],
    hasWeaveKey: !!process.env['WANDB_API_KEY'],
    weaveProject: process.env['WANDB_PROJECT'] ?? null,
    weaveDashboardUrl: weaveDashboardUrl(),
    cache: cacheStatus(),
  })
);

const ClassifyBody = z.object({
  turnId: z.string().optional(),
  candidates: z.array(EmailCandidateSchema).min(1).max(1000),
  /** OpenAI key forwarded from the extension Settings; used here, never sent on. */
  apiKey: z.string().optional(),
  /** Signed-in mail address; namespaces the classify cache (hashed before use). */
  account: z.string().optional(),
  /** Standing user preferences recalled client-side; merged into synthesis. */
  preferences: z.array(UserPreferenceSchema).max(200).optional(),
});

// ---- Classify + synthesize (SSE) ----
// Body: { turnId, candidates, apiKey? }
// Stream events:
//   event: trace          data: AgentTraceEvent JSON
//   event: classification data: { clutter: [...] }
//   event: decisions      data: { decisions: [...] }
//   event: error          data: { message }
//   event: done           data: { ok: true }
app.post('/orchestrate/classify', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = ClassifyBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
  }
  const { turnId = nanoid(), candidates, apiKey, account, preferences } = parsed.data;

  return streamSSE(c, async (stream) => {
    const writer: SseWriter = {
      send: async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      },
    };
    try {
      const result = await runAgentClassification({ turnId, candidates, writer, apiKey, account, preferences });
      await writer.send('classification', { clutter: result.clutter });
      await writer.send('decisions', { decisions: result.decisions, summary: result.summary });
      await writer.send('done', { ok: true });
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      await writer.send('error', { message });
      await writer.send('done', { ok: false });
    }
  });
});

const ChatBody = z.object({
  turnId: z.string().optional(),
  message: z.string().min(1).max(8000),
  apiKey: z.string().optional(),
  /** Optional recent inbox context the client gives the server. */
  context: z
    .object({
      recentClutter: z.array(ClutterFindingSchema).max(50).optional(),
      recentDecisions: z.array(DecisionSchema).max(50).optional(),
    })
    .optional(),
});

// ---- Chat (SSE) ----
// Body: { turnId, message, context? }
// Stream events:
//   event: trace        data: AgentTraceEvent JSON
//   event: chat_reply   data: { text }
//   event: error / done
app.post('/orchestrate/chat', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = ChatBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
  }
  const { turnId = nanoid(), message, context, apiKey } = parsed.data;
  return streamSSE(c, async (stream) => {
    const writer: SseWriter = {
      send: async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      },
    };
    try {
      const text = await runAgentChat({ turnId, message, context, writer, apiKey });
      await writer.send('chat_reply', { text });
      await writer.send('done', { ok: true });
    } catch (err) {
      await writer.send('error', { message: (err as Error).message });
      await writer.send('done', { ok: false });
    }
  });
});

// ---- CopilotKit runtime ----
// Drives the side-panel <CopilotChat>. The runtime LLM produces text replies
// and emits tool calls for any `useCopilotAction` registered client-side
// (cards). Approval/dry-run/kill-switch still apply because every card action
// dispatches `panel/approve_action` etc. through the extension service worker
// → orchestrator → policy gate.
// Handler is built lazily on first request so a missing OPENAI_API_KEY at boot
// doesn't crash the server.
let copilotHandler:
  | ReturnType<typeof copilotRuntimeNodeHttpEndpoint>
  | null = null;
function getCopilotHandler() {
  if (copilotHandler) return copilotHandler;
  copilotHandler = copilotRuntimeNodeHttpEndpoint({
    endpoint: '/copilotkit',
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({
      model: process.env['EMAIL_SIGNAL_MODEL'] ?? 'gpt-4.1-mini',
    }),
  });
  return copilotHandler;
}

app.all('/copilotkit', async (c) => {
  if (!process.env['OPENAI_API_KEY']) {
    return c.json({ error: 'OPENAI_API_KEY not set on server' }, 500);
  }
  const res = await getCopilotHandler()(c.req.raw);
  return res as Response;
});

// ---- Boot ----
void initServerWeave().catch((err) =>
  console.warn('[emailsignal-server] weave init failed', err)
);
initCache();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[emailsignal-server] listening on http://localhost:${info.port}`);
  if (!process.env['OPENAI_API_KEY']) {
    console.warn('[emailsignal-server] OPENAI_API_KEY is not set; LLM endpoints will fail.');
  }
});

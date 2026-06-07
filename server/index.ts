/// <reference types="node" />
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import OpenAI from 'openai';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import type { ClientSettings } from './config.js';
import { resolveConfig } from './config.js';
import {
  ClutterFindingSchema,
  DecisionSchema,
  EmailCandidateSchema,
  UserPreferenceSchema,
} from '../src/schemas/index.js';
import { runAgentClassification, runAgentChat, initServerWeave, weaveDashboardUrl, recordFeedback } from './agents.js';
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
    // Effective default chat model from env (Settings overrides per-request).
    model: resolveConfig().model,
    cache: cacheStatus(),
  })
);

/**
 * Overridable config forwarded from the extension Settings. Every field is
 * optional; the server resolves each via resolveConfig (Settings → env →
 * default), so an empty object reproduces today's env-only behavior exactly.
 */
const SettingsSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  wandbApiKey: z.string().optional(),
  wandbProject: z.string().optional(),
});

/**
 * Build the effective ClientSettings from a request: prefer the new `settings`
 * object, but fold in a legacy top-level `apiKey` when `settings.apiKey` is
 * absent so older extension builds keep working.
 */
function effectiveSettings(
  settings: ClientSettings | undefined,
  topLevelApiKey: string | undefined
): ClientSettings {
  const merged: ClientSettings = { ...(settings ?? {}) };
  if (!merged.apiKey?.trim() && topLevelApiKey?.trim()) merged.apiKey = topLevelApiKey;
  return merged;
}

const ClassifyBody = z.object({
  turnId: z.string().optional(),
  candidates: z.array(EmailCandidateSchema).min(1).max(1000),
  /** OpenAI key forwarded from the extension Settings; used here, never sent on.
   *  Legacy top-level field — superseded by `settings.apiKey`, kept for compat. */
  apiKey: z.string().optional(),
  /** Settings-first config (OpenAI key, model, Weave key/project). */
  settings: SettingsSchema.optional(),
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
  const { turnId = nanoid(), candidates, apiKey, settings, account, preferences } = parsed.data;
  const effective = effectiveSettings(settings, apiKey);

  return streamSSE(c, async (stream) => {
    const writer: SseWriter = {
      send: async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      },
    };
    try {
      const result = await runAgentClassification({ turnId, candidates, writer, settings: effective, account, preferences });
      await writer.send('classification', { clutter: result.clutter });
      await writer.send('decisions', { decisions: result.decisions, summary: result.summary, weaveCallId: result.weaveCallId });
      await writer.send('done', { ok: true });
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      await writer.send('error', { message });
      await writer.send('done', { ok: false });
    }
  });
});

// ---- Production feedback loop (issue #46) ----
// Capture a real user signal (decision accepted / snoozed / muted, or a chat
// thumb) and attach it as weave.feedback to the call the originating scan/chat
// produced — closing the production → eval loop. Best-effort by contract: a bad
// body is a 400, but a missing Weave key or a feedback API failure returns
// { ok: false } and never disrupts the caller. `callId` comes from the scan's
// `weaveCallId` (decisions SSE) that the extension threads back.
const FeedbackBody = z.object({
  callId: z.string().min(1).max(128),
  signal: z.enum(['decision', 'chat']),
  value: z.string().min(1).max(64),
  decisionId: z.string().max(256).optional(),
});

app.post('/feedback', async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = FeedbackBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: 'invalid body', details: parsed.error.flatten() }, 400);
  }
  const { callId, signal, value, decisionId } = parsed.data;
  const ok = await recordFeedback(
    callId,
    signal,
    value,
    decisionId ? { decisionId } : undefined
  ).catch(() => false);
  return c.json({ ok });
});

const ChatBody = z.object({
  turnId: z.string().optional(),
  message: z.string().min(1).max(8000),
  /** Legacy top-level field — superseded by `settings.apiKey`, kept for compat. */
  apiKey: z.string().optional(),
  /** Settings-first config (OpenAI key, model, Weave key/project). */
  settings: SettingsSchema.optional(),
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
  const { turnId = nanoid(), message, context, apiKey, settings } = parsed.data;
  const effective = effectiveSettings(settings, apiKey);
  return streamSSE(c, async (stream) => {
    const writer: SseWriter = {
      send: async (event, data) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      },
    };
    try {
      const text = await runAgentChat({ turnId, message, context, writer, settings: effective });
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
// The env-based handler is built lazily on first request so a missing
// OPENAI_API_KEY at boot doesn't crash the server. When the extension forwards a
// key/model via headers (Settings-first), we build a per-request handler instead
// so the user's own key/model drive CopilotKit chat.
let copilotHandler:
  | ReturnType<typeof copilotRuntimeNodeHttpEndpoint>
  | null = null;
function getEnvCopilotHandler() {
  if (copilotHandler) return copilotHandler;
  copilotHandler = copilotRuntimeNodeHttpEndpoint({
    endpoint: '/copilotkit',
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({ model: resolveConfig().model }),
  });
  return copilotHandler;
}

function buildCopilotHandler(apiKey: string, model: string) {
  // Per-request handler with the forwarded key/model. The installed OpenAIAdapter
  // accepts a custom `openai` client, so we pass the user's key cleanly here.
  return copilotRuntimeNodeHttpEndpoint({
    endpoint: '/copilotkit',
    runtime: new CopilotRuntime(),
    serviceAdapter: new OpenAIAdapter({ model, openai: new OpenAI({ apiKey }) }),
  });
}

app.all('/copilotkit', async (c) => {
  // Settings-first: honor a forwarded key/model (from the CopilotKit client
  // headers). Fall back to the env-based lazy handler when no key header is sent.
  const headerKey = c.req.header('x-openai-key')?.trim();
  const headerModel = c.req.header('x-model')?.trim();
  if (!headerKey && !process.env['OPENAI_API_KEY']) {
    return c.json({ error: 'OPENAI_API_KEY not set on server' }, 500);
  }
  const handler = headerKey
    ? buildCopilotHandler(headerKey, headerModel || resolveConfig().model)
    : getEnvCopilotHandler();
  const res = await handler(c.req.raw);
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

# EmailSignal

> Multi-agent, human-in-the-loop Gmail assistant — runs as a Chrome extension. Reads only what you can see in Gmail. Never deletes or sends mail. Every action passes through an approval card.

EmailSignal is a V1 reference build of an "inbox cockpit": specialized agents scan visible Gmail, classify clutter, surface priority emails, and propose actions (unsubscribe, mark-read, archive) that **only execute after you click Approve**. It is designed so that you can audit every step in a live "Agent activity" panel and every action in a permanent ledger.

EmailSignal V1 does **not** use OAuth or the Gmail API. It works on top of the Gmail web DOM in a content script, so you stay in control of credentials and scope.

---

## Architecture

```
                ┌───────────────┐                    ┌──────────────────────┐
   Gmail tab    │ Content       │  ScanResult        │ Service worker       │
 (mail.google) ─┤ script        ├───────────────────►│ • Orchestrator       │
                │ • DOM scanner │                    │ • Heuristic pass     │
                │ • Highlighter │  Approved action   │ • LLM agents (opt.)  │
                │ • DOM action  │◄───────────────────┤ • Policy gate        │
                └───────────────┘                    │ • Ledger             │
                                                     │ • Memory adapter     │
                                                     └────────┬─────────────┘
                                                              │
                                                              ▼
                                                     ┌──────────────────────┐
                                                     │ Side panel (React)   │
                                                     │ Daily Brief · Clutter│
                                                     │ Actions Ledger · Chat│
                                                     │ Settings · Cockpit   │
                                                     └──────────────────────┘
```

### Agents

V1 ships nine specialized agents, defined in [`src/agents/agent-defs.ts`](src/agents/agent-defs.ts) and wired in [`src/agents/orchestrator.ts`](src/agents/orchestrator.ts):

| Agent | Job |
|---|---|
| **OrchestratorAgent** | Plans the turn. Routes work, enforces "no external action without explicit approval." |
| **InboxScannerAgent** | Normalizes raw DOM data into validated `EmailCandidate`s. Never classifies. |
| **ClutterClassifierAgent** | Categorizes batches in parallel: promotion / newsletter / marketing / cold outreach / etc. |
| **PriorityClassifierAgent** | Identifies money, scheduling, recruiter, reply-needed, family, deadlines, travel. |
| **MemoryAgent** | Recalls preferences. Proposes new memories as *suggestions* — never silent writes. |
| **ActionPolicyAgent** | Validates every `ProposedAction` against the deterministic safety gate in [`policy.ts`](src/agents/policy.ts). |
| **UnsubscribeAgent** | Executes approved unsubscribe flows only. HTTPS-only hrefs. Never submits forms. |
| **DailyBriefAgent** | Builds the six-section daily brief. |
| **AuditLedgerAgent** | Answers "what did you do today / show all unsubscribes / what can we undo?" |

The LLM-backed path uses the **OpenAI Agents SDK** (`@openai/agents`); we wire `ClutterClassifierAgent` and `PriorityClassifierAgent` as **agent-as-tool** so the orchestrator can fire both in parallel and combine results deterministically in code. With no API key configured, EmailSignal falls back to **deterministic heuristics** (`src/agents/heuristics.ts`) — the extension stays useful and private.

### Data contracts

Strict Zod schemas under [`src/schemas`](src/schemas) govern every boundary:

- `EmailCandidate`, `EmailThreadSummary`, `ScanResult`
- `ClutterFinding`, `ClutterSenderGroup`
- `PriorityFinding`
- `ProposedAction`, `ApprovalRecord`, `ExecutedAction`, `ActionLedgerEntry`
- `UserPreference`, `MemoryRecord`, `MemorySuggestion`
- `DailyBrief`, `DailyBriefSection`
- `AgentTraceEvent`
- `ExtMessage` — the wire protocol between content / background / side panel; every inbound message is `parseExtMessage`'d before use.

---

## Setup

```bash
# 1. Clone, install
git clone … && cd email-signal
npm install

# 2. (Optional) Set local env. The extension does NOT read .env — it reads
#    chrome.storage.local. Use the .env file for evals and the (future) Node
#    companion server.
cp .env.example .env
$EDITOR .env

# 3. Build the extension bundle
npm run build:all
```

### Loading the extension in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` directory.
4. Pin the EmailSignal icon to the toolbar.
5. Open Gmail. Click the icon to open the side panel.
6. In the **Settings** tab, paste your OpenAI API key. (Stored in `chrome.storage.local`, never sent anywhere except OpenAI.)

The extension only has host permissions for `https://mail.google.com/*`. It cannot read or write any other tab.

### Environment variables

| Var | Used by | Notes |
|---|---|---|
| `OPENAI_API_KEY` | evals, optional Node side panel | Extension reads its own key from chrome.storage. |
| `WANDB_API_KEY` | Weave tracing | Optional. Without it, traces still appear in the in-extension cockpit. |
| `WANDB_PROJECT` | Weave tracing | Defaults to `email-signal`. |
| `REDIS_URL` | Node-side memory | Without it, memory falls back to `chrome.storage.local`. |
| `EMAIL_SIGNAL_DRY_RUN` | Node evals | Extension dry-run toggle lives in Settings. Default ON. |
| `EMAIL_SIGNAL_SEND_FULL_BODIES` | LLM agents | Default false → only snippets are sent. |
| `EMAIL_SIGNAL_NOTIFY_INTERVAL_MIN` | service worker alarm | Default 30. |

---

## Safety model

EmailSignal V1 was written assuming the **first thing that goes wrong is the agent doing something the user didn't intend**. Specific guarantees:

1. **No destructive actions, ever, in V1.** The policy gate in [`src/agents/policy.ts`](src/agents/policy.ts) hard-blocks delete / send / forward / reply action types. The hard-block precedes the LLM-advised policy agent, so a hallucinated tool name cannot route around it.
2. **No external action without explicit user approval.** The orchestrator generates a `ProposedAction`, the policy gate vets it, and the side panel renders an `ApprovalActionCard`. Only after `panel/approve_action` arrives does the service worker tell the content script to act.
3. **Dry run is ON by default.** Even after approval, no DOM clicks happen until you flip the toggle. Dry-run still records to the ledger so you can review proposals end-to-end.
4. **Kill switch.** One click in the side panel sets `chrome.storage.local[es.killSwitch.v1]=true` and the orchestrator aborts every turn. The service-worker alarm respects it too.
5. **HTTPS-only unsubscribes.** Clicking opens the unsubscribe href in a *new tab* (`window.open(..., 'noopener,noreferrer')`). EmailSignal never auto-submits forms on the destination page, never enters credentials or payment details.
6. **Memory writes always require explicit approval.** Agent-proposed memory updates land in the UI as a `MemorySuggestionCard`. Only `source: 'user'` records skip the approval step.
7. **Bounded body excerpts.** By default we send at most 512 characters of email body to the LLM. Override with `EMAIL_SIGNAL_SEND_FULL_BODIES=true`.
8. **Permanent ledger.** Every proposed, approved, rejected, executed, and blocked action is recorded with timestamps, agent attribution, and the result. Live audit lives in the **Actions** tab.

---

## Observability

`src/weave/tracing.ts` exports `recordTrace(event)` for `session_start / turn_start / agent_start / tool_call / approval_requested / approval_granted / action_executed / action_blocked / error / turn_end`. Three sinks:

1. The in-extension **Agent activity** cockpit (always on).
2. `chrome.storage.local[es.trace.v1]` (last 500 events, for replay).
3. W&B Weave when `WANDB_API_KEY` is set in a Node companion process (the extension service worker can't load the full Weave SDK; see roadmap).

The OpenAI Agents SDK has a `WeaveTracingProcessor`-style integration; we attach it from the Node side runner when wired.

---

## Memory

- **Default** (no Redis): `chrome.storage.local` via `JsonMemoryStore` (in-extension) or an in-memory map (Node tests).
- **Redis** (`REDIS_URL` set, Node context): `RedisMemoryStore` uses hashes for preferences (`es:pref:<userId>`) and streams for memory records (`es:mem:<userId>`). An embedding column is reserved on each record for future vector-search via Redis Iris / RediSearch.
- Both implementations share the [`MemoryStore`](src/memory/interface.ts) interface, so swapping in **Redis Iris Context Retriever** or **Redis Agent Memory** later means writing a new adapter class.

---

## Evals

Fixture-backed regression tests live in [`evals/`](evals).

```bash
npm run evals               # run all four suites
npm run eval:clutter        # heuristic clutter classification precision
npm run eval:priority       # heuristic priority classification
npm run eval:safety         # action policy gate (must block delete/send/etc)
npm run eval:memory         # memory writes always require approval
```

Each suite is a tiny `tsx`-runnable script that loads JSON fixtures and asserts expected category/urgency/allow values. Add cases freely; the suites exit non-zero on any failure so CI can wire them in.

To extend with the LLM-backed agents, write a fixture that calls `runLLMOrchestrator` from `src/agents/llm-runner.ts` with `OPENAI_API_KEY` set. Use Weave to attach the run to your project for inspection.

---

## Limitations (V1)

- **Gmail DOM is the only provider.** Outlook lives in [`src/providers/outlook.ts`](src/providers/outlook.ts) as a stub.
- **No Gmail API / OAuth.** That means we cannot reliably mark-as-read on emails that aren't currently visible in a row; we hide those actions behind row selectors.
- **No semantic memory search.** `recallMemories` filters in app space. Replace with Redis Iris Context Retriever for production.
- **Weave SDK runs only in Node.** Extension traces stream locally and to the side panel; uploading to W&B requires a Node companion (out of V1 scope).
- **Single-user.** USER_ID is hard-coded to `local-user`. Multi-account is straightforward but unimplemented.

---

## Roadmap

- **V1.1 — Companion Node service** for full Weave tracing + Redis Iris + a CLI for replays.
- **V1.2 — Outlook DOM provider** (mirror of Gmail).
- **V2 — Gmail / Microsoft Graph API providers** behind the same `EmailProvider` interface, gated by OAuth.
- **V2.x — Reply drafting agent** with the same explicit-approval pattern (never autosend).
- **V2.x — Per-action reversal** via the AuditLedgerAgent (undo archive/mark-read).
- **CopilotKit AG-UI**: switch the chat tab to AG-UI for richer generative cards in the conversation stream.

---

## Project layout

```
public/
  manifest.json                # Chrome MV3 manifest
  icons/                       # drop real PNGs here

src/
  schemas/                     # Zod contracts (the single source of truth)
  agents/
    agent-defs.ts              # 9 agent names + instructions
    heuristics.ts              # no-LLM fallback classifiers
    orchestrator.ts            # service-worker entry; turns trigger -> dispatch
    llm-runner.ts              # @openai/agents adapter (lazy-imported)
    policy.ts                  # deterministic ActionPolicy gate
    tools.ts                   # tool schemas/executors used by the agents
    runtime.ts                 # key/dry-run/kill-switch lookups
  background/
    service-worker.ts          # MV3 background — owns the message bus
  content/
    index.ts                   # content-script entry
    dom-actions.ts             # safe DOM action executor (post-approval)
    highlighter.ts             # outline + scroll-to
    highlight.css
  providers/
    gmail.ts                   # DOM scanner
    outlook.ts                 # stub
    types.ts                   # EmailProvider interface
  memory/
    interface.ts
    json-store.ts              # chrome.storage / in-memory fallback
    redis-store.ts             # ioredis adapter (Node-only)
    index.ts                   # auto-selects the right store
  ledger/
    local-ledger.ts            # permanent action ledger
  weave/
    tracing.ts                 # recordTrace + Weave init
    bridge.ts                  # ship traces to side panel
  mock/
    sample-emails.ts           # deterministic fixture used by evals + Mock mode
  common/
    constants.ts
    messaging.ts
    log.ts
  sidepanel/
    index.html
    main.tsx
    App.tsx
    styles.css
    tabs/                      # DailyBriefTab, ClutterTab, LedgerTab, ChatTab, SettingsTab
    cards/                     # EmailPriorityCard, ClutterSenderGroupCard,
                               # ApprovalActionCard, DailyBriefSection,
                               # ActionLedgerTable, MemorySuggestionCard,
                               # AgentTraceTimeline
    cockpit/AgentActivityPanel.tsx
    state/                     # zustand store + chrome-runtime bridge

evals/
  fixtures/{clutter,priority,safety,memory}.json
  {clutter,priority,safety,memory}.eval.ts
  run.ts

vite.config.ts                 # CRXJS-powered MV3 build
vite.sidepanel.config.ts       # standalone web build of the side panel (handy for dev)
tsconfig.json
.env.example
```

# Observability (W&B Weave)

Email Signal can trace its LLM pipeline to [Weights & Biases Weave](https://wandb.ai). It is **optional and best-effort**: with no W&B key configured, nothing is sent and behavior is unchanged. Tracing never breaks a run.

All LLM work — and therefore all Weave tracing — happens in the **Node sidecar**. The `weave` package is stubbed out of the Chrome extension build (see `vite.config.ts`), so the extension never talks to W&B directly.

## Enabling Weave

You need a W&B API key (and optionally a project name). Provide them either way:

- **Settings-first (recommended):** paste your W&B API key / project in the extension's **Settings** tab. The extension forwards them to the sidecar, which resolves config via `resolveConfig()` (settings take precedence over env).
- **Environment:** set `WANDB_API_KEY` (and optionally `WANDB_PROJECT`) in `server/.env`.

A note on auth: the weave JS SDK authenticates from `~/.netrc`, **not** from `WANDB_API_KEY` in the environment. The sidecar handles this by calling `weave.login(apiKey)` (which writes the netrc) before `weave.init(project)` — see `ensureServerWeave()` in `server/agents.ts`. So an env-only key works; you don't need to log in manually.

Init is **idempotent and first-wins**: the first key/project to initialize the process wins, and the project can't be hot-swapped mid-process. Restart the sidecar to change it.

When tracing is configured, the sidecar logs the dashboard URL at startup, and `GET /health` returns it as `weaveDashboardUrl`. The URL is built from the canonical `<entity>/<project>` the SDK resolves at init time, so it opens the right project (including for settings-only keys and `entity/project`-form project names).

## What gets traced

Each pipeline stage is wrapped as a named Weave op (`traced()` in `server/agents.ts`):

| Op | Stage |
|---|---|
| `email_signal.day_summary` | the "here's your day" one-liner |
| `email_signal.classify_clutter` | clutter classification |
| `email_signal.synthesize_decisions` | decision synthesis |
| `email_signal.consolidate_decisions` | cross-batch decision merge |
| `email_signal.chat` | chat answers |

Each op shows up in the dashboard with its inputs/outputs.

> **Planned (issue #42):** deeper traces — nested *generation* spans with the real prompt/response text, model name, and token counts — by routing the OpenAI Agents SDK through `setDefaultOpenAIClient(wrapOpenAI(...))` + `setOpenAIAPI('chat_completions')`. Per-scan cost/latency/error attributes follow in #44. Until then, the stage ops are present but their generation-level detail (tokens/cost) is not yet captured.

## Project separation

To keep prod traces, eval runs, and local experiments from piling into one project, use distinct project names:

| Project | Use |
|---|---|
| `email-signal` | production traces (default) |
| `email-signal-evals` | eval runs (default for the eval scripts) |
| `email-signal-dev` | local experimentation — set `WANDB_PROJECT=email-signal-dev` while hacking |

The eval scripts default to `email-signal-evals` (overridable via `WANDB_PROJECT`) so an eval run never pollutes prod traces.

## Reading an eval run

Eval scripts live in `evals/` and are run via the package scripts, e.g.:

```sh
OPENAI_API_KEY=... WANDB_API_KEY=... npm run eval:categorize
```

The categorization eval mirrors its run as a Weave **Evaluation** (a versioned dataset + scorers) in the `email-signal-evals` project. Open it from the W&B **Evaluations** view to compare runs over time. With `WANDB_API_KEY` unset, the eval still computes local pass/fail and silently skips Weave logging.

# Install EmailSignal

> A 2-minute, no-Chrome-Web-Store install. You'll do two things: load the extension into Chrome from a folder, and start a small "helper" on your computer that does the AI thinking.

## What you're about to do

EmailSignal is a Chrome extension plus a tiny local helper. The extension renders your *Today* list inside Gmail or Outlook; the helper, running on your own laptop, is what calls OpenAI. **Nothing leaves your machine except the snippets the helper sends to OpenAI under your own API key** — there's no EmailSignal server, no Gmail/Outlook OAuth, and no auto-send or auto-delete.

The install is two pieces:

- **The extension** — download a zip from GitHub Releases, unzip it, and load the folder in Chrome.
- **The helper** — a small Node program you start once in a terminal and leave running in the background.

Until our Chrome Web Store listing goes live, this is the official install path. It takes about 2 minutes the first time.

---

## Step 1 — Get the extension

1. Open the latest release on GitHub: **<https://github.com/atimothee/email-signal/releases/latest>**
2. Under **Assets**, download `email-signal-extension-<x.y.z>.zip`.
3. Unzip it somewhere you won't accidentally delete — your home folder, `~/Applications/`, or `~/Documents/EmailSignal/` are all fine. **The unzipped folder *is* the extension; deleting it uninstalls EmailSignal.** Don't move it after Chrome has loaded it.

> macOS Finder sometimes adds an extra `__MACOSX/` folder when unzipping. You can ignore it — Chrome will, too — but if Chrome complains "manifest is invalid", make sure you selected the folder that contains `manifest.json`, not the wrapper Finder created.

## Step 2 — Load it in Chrome

1. Open `chrome://extensions` in a new tab.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select the **unzipped folder** from Step 1 (the one with `manifest.json` at the top).
4. Pin the EmailSignal icon to your toolbar — click the puzzle-piece icon in Chrome's toolbar and pin EmailSignal.

If you see the EmailSignal card show up under your extensions list, the extension is installed. It won't do anything yet — the helper isn't running.

## Step 3 — Start the helper

The helper runs on your laptop, holds your OpenAI key, and does the AI work. It needs **Node.js 20 or later** ([download](https://nodejs.org/)).

Open a terminal and run:

```bash
git clone https://github.com/atimothee/email-signal
cd email-signal
npm install
cp .env.example .env
# Open .env and paste your OpenAI API key into OPENAI_API_KEY.
# (Or skip this line and paste the key in the extension's Settings tab later — either works.)
npm run server
```

The terminal will say something like `Listening on http://localhost:3030`. **Leave that terminal window open** — closing it stops the helper, and the extension goes back to the red "no helper" state until you start it again.

> Don't have an OpenAI key? Create one at <https://platform.openai.com/api-keys>. You pay OpenAI directly, on your own account; EmailSignal never sees or stores your key.

For the full list of environment variables (W&B Weave tracing, Redis, model overrides, etc.), see the [Environment variables section in `README.md`](README.md#environment-variables-sidecar).

## Step 4 — Open Gmail (or Outlook) and click the EmailSignal pin

1. Open Gmail (`mail.google.com`) or Outlook (`outlook.live.com` / `outlook.office.com` / `outlook.office365.com`).
2. Click the pinned EmailSignal icon. The side panel opens.
3. The first scan can take **10–20 seconds** while the helper classifies your inbox. After that, scans are cached and snap back instantly.

You're done. The **Today** tab shows the decisions; **Cleanup** groups the clutter; **Settings** has the kill switch, the dry-run toggle, and the field where you can paste your OpenAI key if you skipped the `.env` step.

---

## Troubleshooting

**The header has a red dot, or the panel says "sidecar not reachable".**
The helper isn't running, or its terminal got closed. Re-open the terminal from Step 3 and run `npm run server` again. The dot should turn green within a second of the helper starting.

**Chrome says "manifest is invalid" when I Load unpacked.**
You probably selected the `.zip` file or the wrapper Finder created. Re-select the **inner folder** — the one that contains `manifest.json` directly. On macOS, this is the folder *inside* whatever Finder unzipped.

**The Settings tab says "no OpenAI key".**
Either paste your key into the **OpenAI API key** field in Settings (it gets forwarded to your local helper per request, never anywhere else), or stop the helper, edit `.env` to set `OPENAI_API_KEY=...`, and run `npm run server` again. Settings takes precedence over `.env` when both are set.

**I edited some files / pulled changes and the extension didn't update.**
The released zip is a snapshot — to pick up the latest, download the newest release from <https://github.com/atimothee/email-signal/releases> and Load unpacked from the new folder. If you're building from source, see the **For developers** section of [`README.md`](README.md#for-developers--contributors-build-from-source) — `npm run dev:all` keeps `dist/` rebuilt on save, then click ↻ on the EmailSignal card in `chrome://extensions`.

---

## What this is *not*

- **No OAuth, no Gmail API, no Microsoft Graph.** The extension reads the webmail DOM in your open tab — exactly what you can see.
- **No auto-send, no auto-delete, no auto-archive.** Every action surfaces as an approval card; the policy gate hard-blocks destructive intents even if the model proposes one.
- **Dry-run is ON by default.** Even after you approve an action, EmailSignal records it to the ledger but doesn't actually click anything in Gmail until you flip Dry-Run off in Settings.
- **No EmailSignal server, no telemetry.** The helper runs on your laptop; the only outbound traffic is to OpenAI, under your key.

For the full safety model, agent topology, and architecture, head back to [`README.md`](README.md).

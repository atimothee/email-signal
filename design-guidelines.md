# EmailSignal Design Guidelines

A reference for anyone — human or agent — building new surfaces in this product.
Read this **before** you add a tab, a card, a button, a status indicator, or a
copy string. The patterns here aren't arbitrary; each one was a deliberate
choice against the alternative.

If you're about to add something and you can't find a precedent here, **the
default is to ask whether you should add it at all.** EmailSignal succeeds by
showing the user less, not more.

---

## North star: be genuinely useful, not a gimmick

**Above all else, this product must actually help the user. Not look smart.
Not feel futuristic. Not impress on a screenshot. Help.**

Every other rule in this document derives from that one. When two rules
conflict, the more useful answer wins. When you're unsure whether something
belongs in the UI, the question to ask is not *"is this cool?"* — it's *"does
this make the user's next action faster, clearer, or better-informed?"* If the
answer is no, cut it.

Things that are gimmicks unless they earn their keep:
- A status indicator that doesn't reflect real state (a cosmetic spinner is
  worse than no spinner — it lies).
- A "smart" card that's a worse version of the underlying email row.
- An animation that delays the user instead of confirming a real event.
- A piece of telemetry exposed as UX (event kinds, agent names, tool names —
  these are debug data, not user copy).
- A persistent panel that costs space but rarely earns attention.

We've deleted all of these from the product. Don't add them back.

---

## Product thesis: synthesis, not selection

EmailSignal exists to read N emails and emit **one short list of decisions
the user must make today**, each with the *why* and the *next step* attached.

This is the single most important sentence in this document.

If we show the user the same emails Gmail already shows — even filtered down,
even prettified, even with badges — we've built a worse Gmail. The user
already has Gmail; they don't need another inbox view.

**Synthesis** means: multiple emails collapse into one decision item.
**Selection** means: we picked the "important" emails and listed them.
**We do synthesis. We do not do selection.**

Concrete consequences:
- A "priorities" surface that just lists unread emails with urgency pills is
  not synthesis. It's selection. (We had this. We're killing it. See issue #6.)
- An item on the Today tab is one *decision*, not one *email*. Two recruiters
  waiting on you = one item, not two cards.
- A daily brief is not a list of emails categorized by topic. It's a short
  paragraph of *what the user should do today*, plus 3–8 action items.
- Newsletters, marketing, notifications never appear as decisions, even if
  they match a keyword. The Clutter pipeline already classifies these — never
  let them leak into the Today list.

**Don't pad.** If there are fewer than 2 high-confidence items, show
`Nothing pressing today` and stop. Padding a list with low-confidence picks
to make the app look busy is the worst kind of gimmick — it lies *and* it
trains the user to ignore us.

---

## Core values

These are the lenses to evaluate any new surface against. They're roughly
ordered from most to least important, but every one is non-negotiable.

### 1. Useful before clever

Repeated for emphasis: **useful before clever**. Every interaction must
either help the user decide, help the user act, or help the user trust the
system. If it does none of those, cut it. Cleverness is not free — it costs
attention, space, and credibility.

### 2. Honest about state

The UI must reflect reality.

- A spinner means *work is happening right now*. Not *we kicked off something
  and you can imagine it's still going*.
- A pill that says "Live" means the agents will run. Not "we hope so".
- An empty state means *we looked and found nothing*. Not *we haven't looked
  yet*.
- A "Done: Unsubscribe from Substack" pulse message means an action with that
  title completed. Not "something happened".

If you don't know the real state, **say you don't know.** "Last activity 3m
ago" is better than a fake green dot.

### 3. Alive — the user must feel work happening

Even when nothing is being shown to the user, the agents are usually doing
something. The UI must communicate that. The user should never wonder
*"is anything happening?"*

The **Ambient Pulse** at the top of the panel is the primary surface for this.
It must:
- Show in plain language what the agent is doing right now ("Reading your
  inbox…", "Running classify priorities…", "Waiting for your approval").
- Animate proportional to the work — pulsing rings while a task is in flight,
  calm circle when idle.
- Decay to "Last activity 3m ago" when nothing has happened for a while
  (currently 8s).
- Become more prominent on attention or error (amber / red tone, not just a
  changed icon).

Backstage telemetry — `email_scout · scanning`, `tool_call_start`,
`classification_batch` — is not user-facing copy. Map every event kind to a
plain-language description before showing it.

### 4. Plain language always

The user does not know what an "agent" is. They don't care about "tools". They
don't have a mental model of a "queue". They want to know what's happening
to their email and what they're being asked to decide.

| Don't write                  | Write instead                          |
|------------------------------|----------------------------------------|
| `email_scout · scanning`     | `Reading your inbox…`                  |
| `tool_call_start: classify`  | `Classifying messages…`                |
| `Queue unsubscribe`          | `Unsubscribe`                          |
| `Action executed`            | `Done: Unsubscribe from Substack`      |
| `approval_requested`         | `Waiting for your approval`            |
| `Dry-run skip`               | `Logged (dry run): <action title>`     |
| `proposed by email_scout`    | `Email Scout suggested this`           |
| `kind: custom`               | (just omit it — internal detail)       |
| `confidence 0.84`            | A soft confidence chip, not a number   |

Use second-person imperative for actions: `Pay Verizon $72.34 by Friday`, not
`User should pay Verizon`.

Use the user's voice for explanations: `Sarah asked yesterday — you said yes
verbally last week`, not `Email contains affirmative response keywords`.

### 5. Tactile — actions feel like decisions

When the user approves or rejects something, they should see their decision
register. Not "the card disappears the instant React rerenders". Visible
confirmation. Slide-out, dimming, a brief glow — something physical.

When new work arrives, it springs in. When counts change, the badge pops.
When work is being done, the pulse breathes. The UI is not static.

But: motion must serve confirmation, not theatre. Don't add animation that
costs the user time without telling them something.

### 6. Bold when it serves the user

Where convention works, use it. Where convention is making the product worse,
break it. We've already broken several conventions in this codebase:

- **Live agent activity at the top, not hidden at the bottom.** Most apps
  hide telemetry in a debug panel. We put it front and center because the
  user needs to trust that work is happening.
- **3 tabs, not 5.** Most apps grow tabs. We collapsed Brief / Clutter /
  Actions / Chat / Settings into Today / Cleanup / Chat with chrome demoted
  to header icons. The narrow side-panel viewport doesn't accept tab bloat.
- **No card outlines at full strength.** Most apps put a 1px border on every
  card. We use background contrast and shadow. Borders are a last resort.
- **Empty states are not empty.** A breathing radial-gradient orb says "I'm
  waiting for you" instead of "this is broken".
- **Back chevron, not "Done" button.** Settings dismissal is on the left
  with an iOS-style back affordance + Esc, because "Done" in the top-right
  wasn't discoverable.

When breaking a convention, the burden of proof is on you: write down which
convention you're breaking and why the result is more useful, not just more
unusual.

---

## Visual language

### Color

The accent is **cobalt blue**: `--accent: #4d9eff`. One accent. Not two, not
six. Anything that wants attention uses the accent; anything that doesn't,
doesn't.

```
--bg:            #0a0e1a       (very dark, slight blue tint)
--surface:       #1a2236       (cards / panels)
--surface-2:     #232d44       (chips, inputs)
--surface-3:     #2e3a55       (hover / active)
--accent:        #4d9eff       (primary accent)
--accent-strong: #7ab6ff       (hover, glow)
--accent-soft:   rgba(77, 158, 255, 0.20)  (chip backgrounds)
--success:       #5ed6a3
--warn:          #ffba56
--danger:        #ff6e6e
--text:          #f3f5fa
--text-dim:      #a8b4cc
--text-faint:    #7886a1
```

Use `--accent` for **one** primary CTA per surface. Not five buttons in
accent blue.

Use `--success` / `--warn` / `--danger` only when something is **actually**
in that state. A pill that says "low risk" in green is fine. A green pill on
every card because the screen needs more color is not.

There is an **ambient body glow** — two slow-drifting radial gradients in
the brand blue at low opacity (~14% and ~8%). They breathe over 22s and 28s.
This is part of "the UI feels alive even when idle". Don't disable it. Don't
turn it into a parallax marketing flourish either.

### Typography

```
base size: 14px
line-height: 1.5
font: -apple-system / BlinkMacSystemFont / Inter / system-ui
```

- Card title: 14px / 600 weight
- Brief headline: 17px / 600
- Section label: 11px / 600, uppercase, letter-spacing 0.08em (small, calm)
- Pill / chip: 11px / 500
- Meta / dim copy: 12px in `--text-dim`
- Faint timestamps: 12px in `--text-faint`

Do not introduce a sixth font size. Do not introduce a non-system font. We
are not a typography product.

### Spacing

Cards have 14px padding. Stacks have 10px gaps. Section labels get 18px
breathing room above them, 8px below.

Generous breathing room is part of the product. Cramped UI feels technical
and busy. We are not technical and busy.

### Radii

```
--radius:    14px   (cards, panels, overlays)
--radius-sm: 10px   (buttons, inputs, chips)
pill:        999px
```

### Pills, chips, badges

Soft and translucent. **Not** outlined and saturated. The old design had
hard outlined pills in five colors competing for attention. The new pills:

- Neutral: `--surface-2` background, `--text-dim` text
- Accent: `--accent-soft` background, `--accent-strong` text
- Success / warn / danger: `*-soft` background, full color text

The visual weight should be low. Pills are *labels*, not focal points.

The `ConfidenceBadge`, `RiskBadge`, `ReversibilityBadge` primitives in
`src/sidepanel/cards/primitives.tsx` are the canonical implementations.
Use them. Don't roll your own.

### Cards

```
background: --surface
border: 1px solid --border  (very subtle — rgba(255,255,255,0.09))
border-radius: 14px
padding: 14px
margin-bottom: 10px
shadow: 0 1px 2px rgba(0,0,0,0.25)
animation: spring-in on mount
```

Cards lift their border slightly on hover (`--border-strong`). Cards that
demand action — approval cards — use `.card.accent` for a soft accent-tinted
background, not a hard accent edge.

If you find yourself adding a colored border to make a card stand out, stop
and ask whether you're trying to compensate for the card being uninteresting.

---

## Motion vocabulary

We have a small set of named animations. Use these; don't invent new ones
without a reason.

| Name        | Used for                                | Duration / easing                       |
|-------------|-----------------------------------------|------------------------------------------|
| `spring-in` | Cards, bubbles, banners appearing       | 380ms cubic-bezier(0.34, 1.56, 0.64, 1)  |
| `slide-out` | Approve / reject leaving                | 320ms ease-in                            |
| `pulse-ring`| Live agent indicator rings              | 2s ease-out infinite                     |
| `breathe`   | Empty-state orb, idle states            | 3.6s ease-in-out infinite                |
| `shimmer`   | Working-state pulse bar                 | 3.2s linear infinite                     |
| `count-pop` | Section count badges changing           | 320ms cubic-bezier(0.34, 1.56, 0.64, 1)  |
| `fade-swap` | Pulse message changing                  | 280ms ease-out                           |
| `drift`     | Ambient body glow                       | 22s / 28s ease-in-out infinite           |
| `spin`      | Scan icon button on click               | 800ms ease-out (one-shot)                |

**Always** wrap animations in `prefers-reduced-motion`. The CSS file already
does this at the bottom — don't undo it.

Rules of thumb:
- Spring overshoot is for *arrivals*. Not for *exits* (use ease-in).
- Anything infinite must be calm. Not pulsing at 0.5s. The user shouldn't
  notice it consciously; they should notice when it stops.
- Spinners on user-triggered actions must reflect real state (see *Honest
  about state*). The scan-button spinner is currently a known bug, see #7.

---

## Information architecture

### Three primary scopes

```
Today        Cleanup        Chat
```

These are user-facing modes, not feature areas. Each one answers a different
user question:

- **Today**: *"What do I need to do?"*
- **Cleanup**: *"What's noise I can get rid of?"*
- **Chat**: *"Let me ask a question about my inbox."*

A fourth tab needs a fourth user question. If the new feature answers an
existing question, it belongs inside an existing tab, not next to it.

### Header chrome

The header carries the wordmark, a status chip (Live / Dry run / Kill
switch), and three icon buttons: scan now, history, settings.

Icon buttons toggle their `.active` state when their overlay is open. This is
how the user knows the gear icon is what dismisses Settings.

### Overlays for Settings & History

Settings and History open as full-panel overlays. They have:
- A left-aligned back-chevron + title that's the primary dismiss affordance
- A small `Esc to close` keyboard hint at the right
- An `Esc` keydown handler

This pattern is **mandatory for any new full-panel screen**. The "Done"
button in the top-right pattern was tested and failed to be discoverable —
don't bring it back.

### Cards stack inside tabs

The main content of every tab is a scrolling vertical stack of cards, with
**section labels** breaking phases of decision-making:

- `Decide now (3)` — pending approvals, warn-toned count badge
- `Should I remember this? (2)` — memory suggestions
- `Today's brief` — synthesized brief
- `What needs you today` — action items (when issue #6 lands)

Section labels are tiny uppercase chips, not H2 headers. They orient without
shouting.

---

## Component patterns

### The Ambient Pulse (top of panel, always visible)

The single most important component in the app for liveness. It conveys:

- **Working** state: pulsing rings on a blue glowing dot, shimmer bar across
  the pulse surface, message updates as the agent moves through steps
- **Attention** state: amber tone, slower rings — used when a decision is
  pending
- **Error** state: red core, no rings
- **Idle** state: gray core, message reads `Ready when you are` or
  `Last activity 3m ago`

The message **must** be plain language. It **must** describe what's actually
happening. For action-shaped events it **must** describe what got done with
the action title, not "Action executed". (See the case statements in
`AgentActivityPanel.tsx`.)

Click anywhere on the pulse to expand the timeline below it. Don't add a
separate "expand" button — the whole bar is the affordance.

### Approval cards (the four-action approval model)

Every action the agents propose flows through an `ApprovalActionCard`. The
card has a strict structure — adding fields requires updating this section:

1. Title (verb-led, plain language)
2. Badge row: `RiskBadge`, `ReversibilityBadge`, `ConfidenceBadge`
3. Rationale (one short paragraph in dim copy)
4. **`If you approve` effect preview** — concrete description of what will
   actually happen
5. (For unsubscribe) a sentence explaining we never click confirm for them
6. **`Why shown` reason** — one sentence
7. Primary actions: `Approve once` (accent), `Reject` (danger), optionally
   `Show in Gmail`
8. Secondary row: `Keep suggesting` / `Stop suggesting` — pattern-level
   memory, **never** an "approve all forever"
9. Optional `That's not right` correction affordance

**Critical safety rule**: there is no "approve all forever" button. Every
execution requires deliberate per-card approval. `Keep suggesting` persists
the *pattern of surfacing the suggestion*, never automatic execution. If you
find yourself reaching for a one-click-bulk-approve, you're solving the
wrong problem — fix the synthesis so there are fewer cards instead.

When the user clicks Approve or Reject, the card adds a `.leaving` class and
animates out over 280ms before the dispatch fires. This is non-negotiable —
without the slide-out, decisions feel like nothing happened.

### Batch review panel

When ≥2 batchable actions are pending and they share a risk profile
(`reversible`, `risk ∈ {none, low}`), surface a `Batch N` action on the
"Decide now" section heading that opens the `BatchActionReviewPanel`. The
panel shows every batched action with per-row toggles before the user
confirms — never a single blanket "do all of this".

### Memory suggestion cards

Same physical model as approval cards (spring in, slide out on action), but
with softer chrome (no `.accent` class). The structure:

1. Title: `Remember this?`
2. The suggestion verbatim
3. Badge row: kind chip + `ConfidenceBadge`
4. Rationale
5. **`If you save` effect preview** — explains where it's stored and how to
   revoke
6. **`Why shown` reason**
7. Actions: `Save to memory` (primary), `Discard` (danger),
   `That's not right` (correction)

### Empty states (breathing orb)

The single empty-state primitive lives in `cards/primitives.tsx` as
`EmptyState`. Use it. Don't write a one-off empty view.

Every empty state has:
1. A breathing radial-gradient orb (`empty-orb` class) — the orb is *the*
   "we're waiting for you" cue
2. A two-line title + body
3. **One** primary action button
4. An optional faint hint at the bottom

If you have more than one CTA on an empty state, you don't have an empty
state — you have a missing feature.

### Status chip (header)

Soft chip with a colored dot. Three states:
- Live: gray text, success dot (calm)
- Dry run: amber text + dot
- Kill switch: red text + dot

When the system is in a normal state, the chip should not draw attention.
It only shouts when something is wrong.

### Chat suggestion chips

Horizontally scrollable pill row above the textarea. Not a wrap-row that
creates ragged stacks. The scrollbar is intentional — it tells the user
there's more.

Short copy: `My priorities today?` not `What are my priorities today?`.

### Confidence, risk, reversibility badges

Always render through the primitives in `cards/primitives.tsx`. Confidence
is a chip with a fill, not a percentage number — percentages feel UX-leaky
and pseudo-scientific. Risk is a colored pill matching its level.

---

## Copy & content rules

**Verb-led actions.** `Pay Verizon $72.34 by Friday`, not `Verizon payment
reminder`. The card title should tell the user what to do, not what category
the email is in.

**One-sentence why.** Not a paragraph. Not a bulleted list. One short
sentence in the user's voice.

**Past tense for completed actions.** `Done: Unsubscribe from Substack`
when complete. The action title was forward-looking; the pulse message says
it's done.

**No agent names in casual copy.** The agents are an implementation detail.
Use them in the ledger ("proposed by Email Scout") because that's where the
user is asking *who decided this*. Don't use them in the pulse message — the
pulse is a verb, not an org chart.

**No "queue" / "fire" / "dispatch" / "kick off" / "execute" in user copy.**
Use the user-facing verb: `Unsubscribe`, `Mark read`, `Approve`.

**Empty states are warm, not apologetic.** `Ready when you are` not
`No data available`.

**Errors are concrete and actionable.** `No Gmail tab found. Open
mail.google.com and try again.` not `Scan failed`.

---

## Trust & safety patterns

EmailSignal is read-mostly and human-in-the-loop. The UI must reinforce
this. Some of the design choices above are explicitly safety patterns:

- **Approval cards before any DOM action.** The user always sees what will
  happen *before* it happens. The `If you approve` effect preview is the
  contract.
- **No "approve all forever".** Period. (See above.)
- **Dry run is a first-class state.** When dry-run is on, the status chip
  reads "Dry run" in amber, the pulse message reads `Logged (dry run): X`,
  and the ledger entry distinguishes logged-only from executed.
- **Kill switch is one click away in Settings**, and it sets the status chip
  to a red dot. Don't bury it.
- **Reversibility is shown.** Every approval card carries a
  `ReversibilityBadge`. Irreversible actions (like clicking unsubscribe)
  must say so plainly.
- **Memory writes require explicit approval.** Memory suggestions are their
  own card type; they're never written silently.
- **Correction is always available.** Every agent-produced surface (approval,
  memory suggestion, brief finding, clutter group) should accept a "That's
  not right" correction affordance — see `CorrectThis` in
  `cards/primitives.tsx`.
- **Permanent ledger.** Every proposed and executed action is in the ledger
  forever, behind the History icon. Don't add ways to clear it.

If your feature *cannot* be approved per-instance, surface it as a
**preference** (Settings) instead of an automatic action. Preferences are
explicit, named, and revocable.

---

## Anti-patterns — things we have deliberately removed

This is the most important section to read if you're considering adding
something that feels familiar from other apps.

### A persistent debug cockpit / event timeline at the bottom

We had this. It was the agent activity panel, always open, showing
`13:42:01 · email_scout · scanning`. It cost 220px of vertical space and
read as a developer tool. **Deleted.** The replacement is the Ambient Pulse
at the top — one line of plain-language status with an expandable timeline.

If you find yourself adding a "console" or "raw output" view to the side
panel, you're putting telemetry in the UX. Stop.

### Cosmetic spinners not tied to real state

The Scan button currently has one (a 900ms fake spin — issue #7 is open to
fix it). **This is a known bug, not a pattern to copy.** Never add a
spinner that isn't tied to actual completion.

### "Action executed" without saying what

The pulse used to say `Action executed`. Useless. Now it resolves the
proposed-action title and says `Done: Unsubscribe from Substack`. **Every
action-shaped event** must name the action.

### Showing the user their own emails as "priorities"

We had a priorities tab that was a filtered list of unread emails with
urgency pills. **It was selection, not synthesis** — the user could already
see those emails in Gmail. The replacement is action items (see issue #6).

If you're tempted to render `EmailPriorityCard` somewhere new, ask: *am I
showing the user an email, or a decision?* If an email, you're building the
wrong thing.

### Padding low-signal lists to look busy

`Nothing pressing today` with a calm orb beats a list of low-confidence
guesses. **Never pad.**

### Five tabs

We had Daily Brief / Clutter / Actions / Chat / Settings. Two of those
overlapped (Brief and Actions both showed pending approvals). Two of those
were chrome (Actions/Ledger and Settings). **Collapsed to three** with the
chrome behind header icons. Don't add a fourth tab without deleting one.

### Six saturated colors competing

The old palette had orange + blue + red + green + amber + purple all at full
saturation. **Collapsed to one accent** (cobalt blue) plus softened
semantics. Every additional saturated color is a tax on the user's attention.

### 1px borders on every card / divider lines everywhere

Aggressive 1px borders read as "dense form". We replaced most of them with
background contrast and very subtle borders (alpha 0.09). Don't add a hard
border to make something pop — add spacing.

### "Done" button as the only way to dismiss an overlay

It's not discoverable. Use the back-chevron + Esc pattern from the
`OverlayWrapper` component.

### Generic confidence percentages

`84%` on a card looks scientific and isn't actionable. Use the
`ConfidenceBadge` primitive — it renders a soft chip with a fill, not a
number — and filter out low-confidence items server-side rather than letting
the user do the math.

### One-item theme clusters

A user with one item per theme should see a flat list, not seven one-item
group headers. Cluster only at ≥3 items per theme or when a deadline window
creates one (see issue #6).

### Approve-all-forever / bulk-act bypassing per-item review

Always banned. Use `Keep suggesting` for pattern-level memory and the
`BatchActionReviewPanel` for explicit per-row toggling.

### Cluttered chat suggestion buttons that wrap into multiple rows

A horizontal scroll of pill chips. Not a wrap-row of bordered buttons.

---

## How to evaluate a proposed new surface

Before opening a PR for a new card / tab / status indicator / button,
answer these questions out loud:

1. **What user question does it answer?** If it's the same question an
   existing surface answers, fold it in instead of adding.
2. **Is it synthesis or selection?** If it's a filtered list of emails,
   stop. Synthesize.
3. **Does it require approval?** If yes, use the `ApprovalActionCard`
   primitive — don't roll a custom approval flow.
4. **Does it have a clear state machine?** What are the empty / loading /
   error / success states? Each one needs design.
5. **Does the Ambient Pulse reflect work in this surface?** If your feature
   does background work, the pulse must say so in plain language.
6. **Does the copy use the user's voice?** Verb-led actions, one-sentence
   whys, no agent names, no jargon.
7. **Does it scale gracefully to 0 / 1 / many?** Empty state isn't
   apologetic. Single item doesn't get over-formatted. Many items don't
   require infinite scroll without grouping.
8. **Can the user undo it?** If not, the `ReversibilityBadge` must say so
   loudly.
9. **Have you removed something to add this?** EmailSignal's UI is
   shrinking by design. If you're adding, ask what comes out.
10. **Is it useful, or is it a gimmick?** Useful means *the user's next
    action is faster, clearer, or better-informed*. If it isn't, cut it.

---

## A short closing word

We're building a product whose entire value proposition is "we read your
inbox so you don't have to spend as long on it". Every minute of attention
we ask for back in the side panel must earn its keep against the time we
save the user.

That means: less, not more. Synthesis, not selection. Plain language, not
agent jargon. Honest state, not cosmetic theatre. Tactile decisions, not
silent rerenders. Useful, not a gimmick.

**Useful, not a gimmick.** Read that one more time before you start writing.

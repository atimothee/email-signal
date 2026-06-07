/// <reference types="chrome" />
import { parseExtMessage } from '@schemas/index';
import { sendToBackground } from '@/common/messaging';
import { scanGmailDom, scanGmailInboxPaginated } from '@/providers/gmail';
import { scanOutlookDom, scanOutlookInboxPaginated } from '@/providers/outlook';
import { scrapeAccountIdentity, currentProvider } from '@/providers/identity';
import { DEFAULTS } from '@/common/constants';
import { applyHighlight, removeHighlight } from './highlighter';
import { executeProposedAction } from './dom-actions';
import { log } from '@/common/log';

log.info('content script loaded on', location.host);

void sendToBackground({ kind: 'content/ready' });

// Report which account this tab is signed in as, so the panel's top bar can
// show a constant "you're reading THIS inbox" signal. Gmail renders its
// account chrome asynchronously, so we poll briefly until we find it, then
// re-check on every scan to catch account switches.
let lastIdentityKey = '';
function reportIdentity(): void {
  const identity = scrapeAccountIdentity();
  if (!identity) return;
  const key = `${identity.provider}:${identity.email}`;
  if (key === lastIdentityKey) return;
  lastIdentityKey = key;
  void sendToBackground({ kind: 'content/account_identity', identity });
}
{
  let tries = 0;
  const timer = setInterval(() => {
    reportIdentity();
    if (lastIdentityKey || ++tries >= 15) clearInterval(timer);
  }, 1000);
}

chrome.runtime.onMessage.addListener((raw) => {
  const msg = parseExtMessage(raw);
  if (!msg) return;
  void (async () => {
    try {
      switch (msg.kind) {
        case 'bg/request_scan': {
          // A scan is a good moment to re-confirm the signed-in account.
          reportIdentity();
          // Inbox scans go deep: each provider has its own pagination shape —
          // Gmail clicks "Older" through ~50-row pages; Outlook scrolls a
          // virtualized list. Both gather up to ~500 recent emails in a
          // disposable background tab so the user's own inbox stays put.
          // Thread/search stay shallow (single visible view).
          const provider = currentProvider();
          const reportProgress = (loaded: number) =>
            void sendToBackground({
              kind: 'content/scan_progress',
              loaded,
              target: DEFAULTS.deepScanTarget,
            });
          let scan;
          if (provider === 'outlook') {
            scan =
              msg.source === 'inbox'
                ? await scanOutlookInboxPaginated(DEFAULTS.deepScanTarget, reportProgress)
                : await scanOutlookDom(msg.source);
          } else {
            // Default to Gmail. If we somehow run on a host the manifest
            // didn't intend, the Gmail scanner returns a warning rather than
            // crashing, which is the right failure mode.
            scan =
              msg.source === 'inbox'
                ? await scanGmailInboxPaginated(DEFAULTS.deepScanTarget, reportProgress)
                : await scanGmailDom(msg.source);
          }
          await sendToBackground({ kind: 'content/scan_result', scan });
          break;
        }
        case 'bg/highlight': {
          applyHighlight(msg.selector);
          setTimeout(() => removeHighlight(msg.selector), 8000);
          break;
        }
        case 'bg/open_thread': {
          // Navigate the provider to the thread via its locator (survives
          // pagination), then briefly highlight the row if we have a selector.
          // Two locator shapes today:
          //  - Gmail: hash, e.g. "#all/<threadId>"
          //  - Outlook: query, e.g. "?ItemID=<convId>"
          // The locator is the reliable path; the selector is best-effort.
          if (msg.locator) {
            if (msg.locator.startsWith('#')) {
              if (location.hash === msg.locator) {
                // Already there — nudge a re-render via a no-op hash bounce.
                location.hash = '#all';
              }
              location.hash = msg.locator;
            } else if (msg.locator.startsWith('?')) {
              // Outlook conversation locator. Set the search string; OWA's
              // router re-opens the conversation when the ItemID changes.
              if (location.search !== msg.locator) {
                history.replaceState(null, '', msg.locator);
                window.dispatchEvent(new PopStateEvent('popstate'));
              }
            }
          }
          if (msg.fallbackSelector) {
            const sel = msg.fallbackSelector;
            // Let any navigation settle before trying to highlight the row.
            setTimeout(() => {
              applyHighlight(sel);
              setTimeout(() => removeHighlight(sel), 8000);
            }, msg.locator ? 600 : 0);
          }
          break;
        }
        case 'bg/execute_dom_action': {
          const res = await executeProposedAction(msg.action);
          await sendToBackground({
            kind: 'content/dom_action_result',
            proposedActionId: msg.action.id,
            ok: res.ok,
            error: res.error,
            before: res.before,
            after: res.after,
          });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      log.error('content handler error', err);
    }
  })();
});

/// <reference types="chrome" />
import { parseExtMessage } from '@schemas/index';
import { sendToBackground } from '@/common/messaging';
import { scanGmailDom, scanGmailInboxDeep } from '@/providers/gmail';
import { scrapeAccountIdentity } from '@/providers/identity';
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
          // Inbox scans go deep: scroll to load ~500 recent emails before we
          // synthesize, reporting progress as we go. Thread/search stay shallow.
          const scan =
            msg.source === 'inbox'
              ? await scanGmailInboxDeep(DEFAULTS.deepScanTarget, (loaded) => {
                  void sendToBackground({
                    kind: 'content/scan_progress',
                    loaded,
                    target: DEFAULTS.deepScanTarget,
                  });
                })
              : await scanGmailDom(msg.source);
          await sendToBackground({ kind: 'content/scan_result', scan });
          break;
        }
        case 'bg/highlight': {
          applyHighlight(msg.selector);
          setTimeout(() => removeHighlight(msg.selector), 8000);
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

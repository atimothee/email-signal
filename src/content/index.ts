/// <reference types="chrome" />
import { parseExtMessage } from '@schemas/index';
import { sendToBackground } from '@/common/messaging';
import { scanGmailDom, scanGmailInboxDeep } from '@/providers/gmail';
import { DEFAULTS } from '@/common/constants';
import { applyHighlight, removeHighlight } from './highlighter';
import { executeProposedAction } from './dom-actions';
import { log } from '@/common/log';

log.info('content script loaded on', location.host);

void sendToBackground({ kind: 'content/ready' });

chrome.runtime.onMessage.addListener((raw) => {
  const msg = parseExtMessage(raw);
  if (!msg) return;
  void (async () => {
    try {
      switch (msg.kind) {
        case 'bg/request_scan': {
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

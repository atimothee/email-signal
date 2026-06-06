import { ProposedAction } from '@schemas/index';

/**
 * Hard policy gate. The LLM-backed ActionPolicyAgent is advisory; this
 * function is the final, deterministic check that runs before ANY action
 * leaves the orchestrator.
 *
 * If this returns { allow: false }, the action is recorded as blocked and
 * never reaches the user as an ApprovalActionCard.
 */
export function checkPolicy(action: ProposedAction): { allow: boolean; reason?: string } {
  // 1. Hard blocklist: no destructive or send-shaped actions in V1.
  const forbidden = ['delete_email', 'send_email', 'forward_email', 'reply_email'];
  if (forbidden.includes(action.type as string)) {
    return { allow: false, reason: `Action type "${action.type}" is permanently blocked in V1.` };
  }

  // 2. Permission shape must match action type.
  const expected: Record<ProposedAction['type'], ProposedAction['requiredPermission']> = {
    open_email: 'dom_read',
    highlight_element: 'dom_highlight',
    scroll_to_element: 'dom_highlight',
    find_unsubscribe_link: 'dom_read',
    click_unsubscribe: 'dom_click_unsubscribe',
    mark_read: 'dom_click_mark_read',
    archive: 'dom_click_archive',
    apply_label: 'label_suggest',
    suggest_label: 'label_suggest',
    remember_preference: 'memory_write',
  };
  if (expected[action.type] !== action.requiredPermission) {
    return { allow: false, reason: 'requiredPermission does not match action type.' };
  }

  // 3. Risk must be set sensibly.
  const minRisk: Record<ProposedAction['type'], ProposedAction['risk']> = {
    open_email: 'none',
    highlight_element: 'none',
    scroll_to_element: 'none',
    find_unsubscribe_link: 'none',
    click_unsubscribe: 'medium',
    mark_read: 'low',
    archive: 'low',
    apply_label: 'low',
    suggest_label: 'none',
    remember_preference: 'low',
  };
  const order = ['none', 'low', 'medium', 'high'] as const;
  if (order.indexOf(action.risk) < order.indexOf(minRisk[action.type])) {
    return { allow: false, reason: `risk too low for action type "${action.type}".` };
  }

  // 4. click_unsubscribe must have an HTTPS unsubscribe href.
  if (action.type === 'click_unsubscribe') {
    const href = action.params['unsubscribeHref'];
    if (typeof href !== 'string' || !/^https:\/\//.test(href)) {
      return { allow: false, reason: 'click_unsubscribe requires a HTTPS unsubscribeHref.' };
    }
  }

  // 5. memory_write actions always need explicit approval.
  if (action.requiredPermission === 'memory_write' && action.approvalStatus === 'not_required') {
    return { allow: false, reason: 'Memory writes always require explicit approval.' };
  }

  return { allow: true };
}

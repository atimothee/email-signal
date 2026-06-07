import { nanoid } from 'nanoid';
import type { ActionType, Decision, ProposedAction, RiskLevel } from '@schemas/index';
import { ProposedActionSchema } from '@schemas/index';

/**
 * Per-action-type metadata. The `requiredPermission` and `risk` values MUST
 * match `checkPolicy` (src/agents/policy.ts) exactly, otherwise a normalized
 * action would be rejected by the deterministic gate. This is the single place
 * that turns a loose, model-supplied action shape into a gate-valid
 * ProposedAction — which is why the chat agent can no longer produce a card with
 * "undefined risk": risk is always derived here, never taken from the model.
 */
interface ActionMeta {
  risk: RiskLevel;
  reversible: boolean;
  requiredPermission: ProposedAction['requiredPermission'];
  /** Eligible for low-risk batch approval. */
  batchable?: boolean;
  /** Needs a resolved Gmail row selector (params.rowSelector) to execute. */
  needsRowSelector?: boolean;
  /** Plain-language effect shown on the approval card. */
  effect: string;
  /** Fallback human title when the model didn't supply one. */
  title: string;
}

export const ACTION_META: Record<ActionType, ActionMeta> = {
  open_email: {
    risk: 'none', reversible: true, requiredPermission: 'dom_read',
    needsRowSelector: true, effect: 'Opens this email in Gmail.', title: 'Open this email',
  },
  highlight_element: {
    risk: 'none', reversible: true, requiredPermission: 'dom_highlight',
    needsRowSelector: true, effect: 'Highlights this in Gmail.', title: 'Highlight in Gmail',
  },
  scroll_to_element: {
    risk: 'none', reversible: true, requiredPermission: 'dom_highlight',
    needsRowSelector: true, effect: 'Scrolls Gmail to this email.', title: 'Scroll to this email',
  },
  find_unsubscribe_link: {
    risk: 'none', reversible: true, requiredPermission: 'dom_read',
    effect: 'Finds the unsubscribe link without clicking it.', title: 'Find unsubscribe link',
  },
  click_unsubscribe: {
    risk: 'medium', reversible: false, requiredPermission: 'dom_click_unsubscribe',
    effect: "Opens the sender's unsubscribe page in a new tab.", title: 'Unsubscribe',
  },
  mark_read: {
    risk: 'low', reversible: true, requiredPermission: 'dom_click_mark_read',
    needsRowSelector: true, batchable: true, effect: 'Marks this as read. Undo from History.', title: 'Mark as read',
  },
  archive: {
    risk: 'low', reversible: true, requiredPermission: 'dom_click_archive',
    needsRowSelector: true, batchable: true, effect: 'Archives this out of the inbox. Undo from History.', title: 'Archive',
  },
  apply_label: {
    risk: 'low', reversible: true, requiredPermission: 'label_suggest',
    needsRowSelector: true, effect: 'Adds a label.', title: 'Apply label',
  },
  suggest_label: {
    risk: 'none', reversible: true, requiredPermission: 'label_suggest',
    effect: 'Suggests a label — nothing is applied until you pick.', title: 'Suggest a label',
  },
  remember_preference: {
    risk: 'low', reversible: true, requiredPermission: 'memory_write',
    effect: 'Saves a preference. Editable in Settings.', title: 'Remember a preference',
  },
};

export function isActionType(t: unknown): t is ActionType {
  return typeof t === 'string' && t in ACTION_META;
}

/** A loose action as the chat model might emit it — only `type` is guaranteed. */
export type LooseAction = Partial<ProposedAction> & { type: ActionType };

/**
 * Find the Decision a loose action refers to, so we can borrow its real Gmail
 * row selector + emailId. The model only ever sees decision ids / emailIds in
 * its readable context; it cannot invent Gmail DOM selectors, so we resolve
 * them from live state here.
 */
function findDecision(raw: LooseAction, decisions: Decision[]): Decision | undefined {
  const decisionId = (raw.params?.['decisionId'] as string | undefined) ?? raw.id;
  const byId = decisions.find((d) => d.id === decisionId);
  if (byId) return byId;
  if (raw.emailId) {
    const byEmail = decisions.find((d) => d.emailIds.includes(raw.emailId!));
    if (byEmail) return byEmail;
  }
  return undefined;
}

/**
 * Turn a loose, model-supplied action into a fully-formed, gate-valid
 * ProposedAction. Fills risk / reversibility / permission / effect from
 * ACTION_META (never from the model) and resolves the Gmail row selector from a
 * referenced decision when the action needs one.
 */
export function normalizeProposedAction(raw: LooseAction, decisions: Decision[] = []): ProposedAction {
  const meta = ACTION_META[raw.type];
  if (!meta) throw new Error(`unknown action type: ${String(raw.type)}`);

  const params: Record<string, unknown> = { ...(raw.params ?? {}) };
  const decision = findDecision(raw, decisions);

  if (meta.needsRowSelector && !params['rowSelector'] && decision?.rowSelector) {
    params['rowSelector'] = decision.rowSelector;
  }
  // highlight/scroll read params.selector; mirror the resolved row selector.
  if (
    (raw.type === 'highlight_element' || raw.type === 'scroll_to_element') &&
    !params['selector'] &&
    typeof params['rowSelector'] === 'string'
  ) {
    params['selector'] = params['rowSelector'];
  }

  return ProposedActionSchema.parse({
    id: raw.id ?? nanoid(),
    emailId: raw.emailId ?? decision?.emailIds[0],
    threadId: raw.threadId,
    type: raw.type,
    title: raw.title?.trim() || (decision ? `${meta.title}: ${decision.title}` : meta.title),
    rationale: raw.rationale?.trim() || meta.effect,
    effectPreview: raw.effectPreview ?? meta.effect,
    whyShown: raw.whyShown,
    proposedBy: raw.proposedBy ?? 'orchestrator',
    confidence: raw.confidence,
    requiredPermission: meta.requiredPermission,
    reversible: raw.reversible ?? meta.reversible,
    batchable: meta.batchable,
    risk: meta.risk,
    approvalStatus: 'pending',
    params,
    proposedAt: new Date().toISOString(),
  });
}

/** True when this action can't execute yet because we couldn't locate its row. */
export function isMissingTarget(action: ProposedAction): boolean {
  const meta = ACTION_META[action.type];
  if (meta.needsRowSelector && !action.params['rowSelector'] && !action.params['selector']) return true;
  if (action.type === 'click_unsubscribe') {
    const href = action.params['unsubscribeHref'];
    return typeof href !== 'string' || !/^https:\/\//.test(href);
  }
  return false;
}

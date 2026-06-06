import React, { useMemo, useState } from 'react';
import type { ProposedAction } from '@schemas/index';
import { ConfidenceBadge, ReversibilityBadge, RiskBadge } from './primitives';

/**
 * Batch approval is *only* allowed for low-risk reversible actions
 * (mark_read and archive). Anything outside that envelope is filtered
 * out and shown as a notice. One explicit confirmation gates the batch.
 *
 * Unsubscribe is NEVER batchable in V1.
 */
const BATCHABLE_TYPES = new Set<ProposedAction['type']>(['mark_read', 'archive']);

interface Props {
  actions: ProposedAction[];
  onConfirm: (acceptedIds: string[]) => void;
  onCancel: () => void;
}

function isBatchEligible(a: ProposedAction): boolean {
  return BATCHABLE_TYPES.has(a.type) && a.reversible && (a.risk === 'none' || a.risk === 'low');
}

export function BatchActionReviewPanel({ actions, onConfirm, onCancel }: Props): JSX.Element {
  const eligible = useMemo(() => actions.filter(isBatchEligible), [actions]);
  const ineligible = useMemo(() => actions.filter((a) => !isBatchEligible(a)), [actions]);

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(eligible.map((a) => [a.id, true]))
  );
  const [confirmed, setConfirmed] = useState(false);

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const acceptedIds = eligible.filter((a) => selected[a.id]).map((a) => a.id);
  const allOff = acceptedIds.length === 0;

  const summary = summarize(eligible.filter((a) => selected[a.id]));

  return (
    <article className="card accent batch-panel" aria-labelledby="batch-title">
      <h3 id="batch-title">Review as a batch</h3>
      <div className="meta">
        Only reversible mark-as-read and archive can be batched. One tap runs them all.
      </div>

      {ineligible.length > 0 && (
        <p className="subtle" style={{ marginTop: 8 }}>
          {ineligible.length} can't be batched (higher risk or not reversible). Approve those one by one.
        </p>
      )}

      {eligible.length === 0 ? (
        <div className="subtle" style={{ marginTop: 8 }}>
          No batch-eligible actions in this set.
        </div>
      ) : (
        <>
          <div className="batch-list" role="list">
            {eligible.map((a) => (
              <div
                key={a.id}
                className={`batch-row ${selected[a.id] ? '' : 'unchecked'}`}
                role="listitem"
              >
                <input
                  type="checkbox"
                  checked={!!selected[a.id]}
                  onChange={() => toggle(a.id)}
                  aria-label={`Include ${a.title}`}
                />
                <div style={{ minWidth: 0 }}>
                  <div className="title">{a.title}</div>
                  <div className="meta">
                    {humanizeType(a.type)}
                    {a.emailId ? ` · ${a.emailId.slice(0, 14)}…` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <RiskBadge risk={a.risk} />
                  <ReversibilityBadge reversible={a.reversible} />
                  {typeof a.confidence === 'number' && <ConfidenceBadge value={a.confidence} />}
                </div>
              </div>
            ))}
          </div>

          <div className="effect-preview">
            <div className="label">If you approve the batch</div>
            <div>{summary}</div>
          </div>

          <div className="batch-confirm">
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I've reviewed each item above and confirm running these{' '}
                <strong>{acceptedIds.length}</strong> reversible action
                {acceptedIds.length === 1 ? '' : 's'} now.
              </span>
            </label>
          </div>
        </>
      )}

      <div className="actions" style={{ marginTop: 12 }}>
        <button
          className="primary"
          disabled={!confirmed || allOff}
          onClick={() => onConfirm(acceptedIds)}
        >
          Run {acceptedIds.length || ''} {acceptedIds.length === 1 ? 'action' : 'actions'}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </article>
  );
}

function humanizeType(t: ProposedAction['type']): string {
  return t.replace(/_/g, ' ');
}

function summarize(actions: ProposedAction[]): string {
  if (actions.length === 0) return 'Nothing selected.';
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.type] = (counts[a.type] ?? 0) + 1;
  const parts = Object.entries(counts).map(([t, n]) => `${n} ${humanizeType(t as ProposedAction['type'])}`);
  return `${parts.join(', ')}. All are reversible from the action history.`;
}

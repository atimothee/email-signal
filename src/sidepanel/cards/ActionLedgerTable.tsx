import React, { useState } from 'react';
import type { ActionLedgerEntry } from '@schemas/index';
import { EmptyState } from './primitives';

interface Props {
  entries: ActionLedgerEntry[];
}

function status(e: ActionLedgerEntry): { label: string; cls: string } {
  if (e.executed?.result.ok) return { label: 'executed', cls: 'success' };
  if (e.executed && !e.executed.result.ok) return { label: 'failed', cls: 'critical' };
  if (e.approval?.status === 'approved') return { label: 'approved', cls: 'high' };
  if (e.approval?.status === 'rejected') return { label: 'rejected', cls: 'warn' };
  return { label: 'pending', cls: 'warn' };
}

export function ActionLedgerTable({ entries }: Props): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <EmptyState
        title="No actions yet"
        body="The ledger is your audit trail. Every proposed, approved, executed, or blocked action shows up here."
      />
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Action</th>
          <th>By</th>
          <th>Reversible</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {[...entries].reverse().map((e) => {
          const s = status(e);
          const isOpen = openId === e.id;
          return (
            <React.Fragment key={e.id}>
              <tr
                onClick={() => setOpenId(isOpen ? null : e.id)}
                style={{ cursor: 'pointer' }}
              >
                <td className="subtle">{new Date(e.createdAt).toLocaleString()}</td>
                <td>
                  <div>{e.proposed.title}</div>
                  <div className="subtle">{e.proposed.type.replace(/_/g, ' ')}</div>
                </td>
                <td className="subtle">{e.proposed.proposedBy}</td>
                <td>
                  <span className={`pill ${e.proposed.reversible ? 'success' : 'critical'}`}>
                    {e.proposed.reversible ? 'yes' : 'no'}
                  </span>
                </td>
                <td>
                  <span className={`pill ${s.cls}`}>{s.label}</span>
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={5} style={{ background: 'var(--surface-2)' }}>
                    <div className="subtle" style={{ padding: '6px 4px' }}>
                      <div><strong>Rationale:</strong> {e.proposed.rationale}</div>
                      {e.proposed.effectPreview && (
                        <div style={{ marginTop: 4 }}>
                          <strong>Effect:</strong> {e.proposed.effectPreview}
                        </div>
                      )}
                      {e.executed && (
                        <div style={{ marginTop: 4 }}>
                          <strong>Result:</strong>{' '}
                          {e.executed.result.ok ? 'ok' : e.executed.result.error ?? 'failed'}
                          {e.executed.dryRun && ' (dry run)'}
                        </div>
                      )}
                      {e.approval?.note && (
                        <div style={{ marginTop: 4 }}>
                          <strong>Note:</strong> {e.approval.note}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

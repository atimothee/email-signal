import React from 'react';
import type { ActionLedgerEntry } from '@schemas/index';

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
  if (entries.length === 0) {
    return <div className="empty">No actions yet — the ledger is your audit trail.</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Action</th>
          <th>By</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {[...entries].reverse().map((e) => {
          const s = status(e);
          return (
            <tr key={e.id}>
              <td className="subtle">{new Date(e.createdAt).toLocaleString()}</td>
              <td>
                <div>{e.proposed.title}</div>
                <div className="subtle">{e.proposed.type}</div>
              </td>
              <td className="subtle">{e.proposed.proposedBy}</td>
              <td><span className={`pill ${s.cls}`}>{s.label}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

import React from 'react';
import { usePanelStore } from '../state/store';
import { ActionLedgerTable } from '../cards/ActionLedgerTable';

export function LedgerTab(): JSX.Element {
  const ledger = usePanelStore((s) => s.ledger);
  return (
    <>
      <div className="subtle" style={{ marginBottom: 12 }}>
        Every action — proposed, approved, executed — is logged here.
      </div>
      <ActionLedgerTable entries={ledger} />
    </>
  );
}

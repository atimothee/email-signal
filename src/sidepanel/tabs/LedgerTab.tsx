import React from 'react';
import { usePanelStore } from '../state/store';
import { ActionLedgerTable } from '../cards/ActionLedgerTable';

export function LedgerTab(): JSX.Element {
  const ledger = usePanelStore((s) => s.ledger);
  return (
    <>
      <div className="subtle" style={{ marginBottom: 10 }}>
        Permanent audit trail of every proposed and executed action. Nothing gets executed
        without your explicit approval, and the ledger captures who proposed it, when you
        approved, and what happened.
      </div>
      <ActionLedgerTable entries={ledger} />
    </>
  );
}

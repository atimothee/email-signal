import React, { useState } from 'react';
import { usePanelStore } from './state/store';
import { openGmailTab } from './state/bridge';
import type { MailProvider } from '@schemas/index';

/**
 * Top-bar identity chip (issue #10). A constant, zero-click answer to "which
 * inbox am I looking at?" — profile photo, provider glyph, and address. Falls
 * back to a monogram when the provider gives no photo, and to a "Connect"
 * call-to-action when no account has been read yet.
 */

const PROVIDER_LABEL: Record<MailProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
};

function ProviderGlyph({ provider }: { provider: MailProvider }): JSX.Element {
  if (provider === 'outlook') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="4" fill="#0A6ED1" />
        <circle cx="12" cy="12" r="4.3" fill="none" stroke="#fff" strokeWidth="2.2" />
      </svg>
    );
  }
  // Gmail: white envelope with the signature red "M" valley.
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="3" fill="#fff" />
      <path
        d="M4 7.5 12 13l8-5.5"
        fill="none"
        stroke="#EA4335"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M4 7.5V18M20 7.5V18" stroke="#EA4335" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function monogram(email: string, name?: string): string {
  const base = (name?.trim() || email).trim();
  return base ? base[0]!.toUpperCase() : '?';
}

export function AccountIndicator(): JSX.Element {
  const account = usePanelStore((s) => s.account);
  const [imgFailed, setImgFailed] = useState(false);

  if (!account) {
    return (
      <div className="account-bar">
        <button className="account-connect" onClick={openGmailTab} title="Open Gmail to connect an inbox">
          <span className="account-connect-dot" />
          Connect an inbox
        </button>
      </div>
    );
  }

  const showPhoto = Boolean(account.photoUrl) && !imgFailed;
  const tooltip = account.displayName ? `${account.displayName} · ${account.email}` : account.email;

  return (
    <div className="account-bar" title={tooltip}>
      <span className="account-avatar">
        {showPhoto ? (
          <img
            src={account.photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="account-monogram">{monogram(account.email, account.displayName)}</span>
        )}
        <span className={`account-provider ${account.provider}`} aria-hidden="true">
          <ProviderGlyph provider={account.provider} />
        </span>
      </span>
      <span className="account-email">{account.email}</span>
      <span className="account-provider-name">{PROVIDER_LABEL[account.provider]}</span>
    </div>
  );
}

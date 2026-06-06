import type { ScanResult, EmailCandidate } from '@schemas/index';

/**
 * EmailProvider — abstraction so V2 can add Outlook without rewriting agents.
 * V1 only implements GmailDomProvider (read-only DOM).
 *
 * Providers MUST be:
 *  - read-only by default
 *  - defensive about selectors (Gmail mutates them; failures should warn, not throw)
 *  - free of side effects beyond scrolling/highlighting
 */
export interface EmailProvider {
  readonly id: 'gmail' | 'outlook';
  scan(source: 'inbox' | 'search' | 'thread'): Promise<ScanResult>;
  /** Optional: fetch a single thread's expanded view (current open thread only in V1). */
  readOpenThread?(): Promise<EmailCandidate[]>;
}

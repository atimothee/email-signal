import type { EmailProvider } from './types';
import { ScanResultSchema } from '@schemas/index';

/**
 * Outlook provider placeholder. Adding real support means:
 *  - Implementing OWA DOM scanning (outlook.live.com / outlook.office.com)
 *  - OR using the Microsoft Graph API once OAuth is added in V2
 *  - Mapping Microsoft folder concepts (Focused/Other) to clutter signals
 *
 * For now this returns an empty scan so the orchestrator never crashes when
 * a Outlook tab is active.
 */
export const OutlookProvider: EmailProvider = {
  id: 'outlook',
  async scan(source) {
    return ScanResultSchema.parse({
      provider: 'outlook',
      scannedAt: new Date().toISOString(),
      source,
      candidates: [],
      threads: [],
      warnings: ['Outlook provider not implemented in V1.'],
    });
  },
};

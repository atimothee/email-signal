import { z } from 'zod';

/**
 * Identity of the mail account currently connected to the panel.
 *
 * Email Signal has no OAuth — it reads the visible Gmail DOM. So the
 * "connected account" is whatever account the active mail tab is signed in
 * as, scraped from the provider's own account chrome (avatar + aria-label).
 * We only ever emit this when we managed to read a real email address; a
 * partial/garbled scrape returns null upstream rather than a half record.
 */
export const MailProviderSchema = z.enum(['gmail', 'outlook']);
export type MailProvider = z.infer<typeof MailProviderSchema>;

export const AccountIdentitySchema = z.object({
  provider: MailProviderSchema,
  /** Signed-in address, e.g. "you@gmail.com". Required — the trust signal. */
  email: z.string().min(3).max(320),
  /** Human display name when the provider exposes one. */
  displayName: z.string().max(200).optional(),
  /** Absolute https URL to the provider profile photo, when available. */
  photoUrl: z.string().url().optional(),
});
export type AccountIdentity = z.infer<typeof AccountIdentitySchema>;

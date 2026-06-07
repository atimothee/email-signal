import { AccountIdentity, AccountIdentitySchema, MailProvider } from '@schemas/index';

/**
 * Scrapes the connected mail account's identity from the provider's own
 * account chrome. There is no OAuth here — the "connected account" is simply
 * whoever the visible mail tab is signed in as. We read the avatar + the
 * account-switcher aria-label, and only return a record once we have a real
 * email address (the trust signal in the top bar). A garbled/partial read
 * returns null so the panel keeps showing its last-known good identity.
 */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export function currentProvider(): MailProvider | null {
  const h = location.host;
  if (h.includes('mail.google.com')) return 'gmail';
  if (h.includes('outlook.')) return 'outlook';
  return null;
}

function scrapeGmail(): AccountIdentity | null {
  // The account-switcher button is the most stable identity anchor in Gmail:
  // it links to SignOutOptions and its aria-label embeds the signed-in
  // address; the avatar <img> inside it is the profile photo. We fall back to
  // the localized "Google Account" label match if the href shape changes.
  const btn =
    document.querySelector<HTMLElement>('a[href*="SignOutOptions"]') ??
    document.querySelector<HTMLElement>('a[aria-label*="Google Account"]');
  if (!btn) return null;

  const label = btn.getAttribute('aria-label') ?? '';
  const email = label.match(EMAIL_RE)?.[0];
  if (!email) return null;

  // "Google Account: <Name> (<email>)" — the name is the bit before the paren.
  let displayName: string | undefined;
  const nameMatch = label.match(/:\s*(.+?)\s*[(\n]/);
  if (nameMatch?.[1]) displayName = nameMatch[1].trim() || undefined;

  const img = btn.querySelector('img');
  let photoUrl = img?.getAttribute('src') ?? undefined;
  if (photoUrl && !/^https?:/i.test(photoUrl)) photoUrl = undefined;
  if (!displayName) {
    const alt = img?.getAttribute('alt')?.trim();
    if (alt && !EMAIL_RE.test(alt)) displayName = alt;
  }

  const parsed = AccountIdentitySchema.safeParse({
    provider: 'gmail',
    email,
    displayName,
    photoUrl,
  });
  // If the photo URL fails strict validation, still surface email + name.
  return parsed.success ? parsed.data : { provider: 'gmail', email, displayName };
}

export function scrapeAccountIdentity(): AccountIdentity | null {
  switch (currentProvider()) {
    case 'gmail':
      return scrapeGmail();
    // 'outlook' is not yet in the manifest match list — placeholder for the
    // multi-account work (#5). The provider icon already renders for it.
    default:
      return null;
  }
}

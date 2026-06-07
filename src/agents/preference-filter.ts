import type { Decision, UserPreference } from '@schemas/index';

/**
 * Deterministic ignored_sender (Mute) filtering, shared by the orchestrator's
 * scan synthesis. Kept in its own module — with type-only schema imports — so it
 * can be unit-tested without dragging in the orchestrator's chrome/runtime graph
 * (#72). The model is asked to honour ignored_sender via the synthesis prompt,
 * but it routinely forgets to for clutter classification; these functions are the
 * hard guarantee that a muted sender never re-surfaces in a re-scan.
 */

/** The set of muted sender domains/addresses (lowercased), or empty. */
export function ignoredSenderSet(prefs: UserPreference[]): Set<string> {
  return new Set(
    prefs
      .filter((p) => p.kind === 'ignored_sender' && typeof p.value === 'string')
      .map((p) => (p.value as string).toLowerCase())
  );
}

/** True when `domain` is muted directly or as a subdomain of a muted domain
 *  (a mute on "acme.com" also catches "mail.acme.com"). */
function isIgnoredDomain(domain: string, ignored: Set<string>): boolean {
  const d = domain.toLowerCase();
  if (ignored.has(d)) return true;
  for (const ig of ignored) if (d === ig || d.endsWith(`.${ig}`)) return true;
  return false;
}

/** True when a sender string (an address OR a bare domain) is muted. Extracts
 *  the domain from an address so a mute on the domain catches every address. */
export function senderMatchesIgnored(sender: string, ignored: Set<string>): boolean {
  const s = sender.toLowerCase();
  if (ignored.has(s)) return true;
  const at = s.lastIndexOf('@');
  return isIgnoredDomain(at >= 0 ? s.slice(at + 1) : s, ignored);
}

/** Drop priority decisions whose sender is muted. */
export function filterDecisionsByPreferences(
  decisions: Decision[],
  prefs: UserPreference[]
): Decision[] {
  const ignored = ignoredSenderSet(prefs);
  if (ignored.size === 0) return decisions;
  return decisions.filter((d) => !d.senders.some((s) => senderMatchesIgnored(s, ignored)));
}

/** Drop any clutter finding/group whose senderDomain is muted. Generic over
 *  ClutterFinding and ClutterSenderGroup — both carry senderDomain — so the same
 *  filter applies to the findings list and the grouped view before broadcast. */
export function filterClutterByPreferences<T extends { senderDomain: string }>(
  items: T[],
  prefs: UserPreference[]
): T[] {
  const ignored = ignoredSenderSet(prefs);
  if (ignored.size === 0) return items;
  return items.filter((it) => !isIgnoredDomain(it.senderDomain, ignored));
}

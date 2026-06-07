/** Tiny classnames join — avoid pulling clsx for one-liner usage. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

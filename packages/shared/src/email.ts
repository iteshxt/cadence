/**
 * Practical address check shared by the CSV parser and the API. It accepts what real mail
 * providers accept for outreach lists and rejects the junk that shows up in exported sheets
 * (missing TLDs, spaces, stray quotes). It is intentionally stricter than RFC 5322.
 */
export const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/i;

export const EMAIL_MAX_LENGTH = 254;

export function normalizeEmail(raw: string): string {
  return raw
    .trim()
    .replace(/^mailto:/i, '')
    .toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (email.length > EMAIL_MAX_LENGTH) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at > 64) return false;
  return EMAIL_RE.test(email);
}

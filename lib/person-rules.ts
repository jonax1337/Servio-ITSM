/** Pure validation rules for creating and editing people (users). */

export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt ignores everything past 72 bytes, so longer passwords would silently be cut. */
export const MAX_PASSWORD_BYTES = 72;

// Deliberately loose: one "@", no whitespace, a dot in the domain. The mail
// server is the real validator; this only catches typos.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmailShape(email: string): boolean {
  return EMAIL_SHAPE.test(email);
}

/** Returns the problem with an initial password, or null when it is acceptable. */
export function passwordError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`;
  }
  return null;
}

/** The distinct, non-empty group ids a person form posted, in the order chosen. */
export function distinctIds(values: FormDataEntryValue[]): string[] {
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
}

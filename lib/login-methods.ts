/**
 * Which sign-in forms the login page offers. Pure rules; the page supplies the facts
 * (is SSO configured, does any active account have a password).
 *
 * `AUTH_PASSWORD_LOGIN`:
 *  - `on`   always show the email/password form
 *  - `off`  never show it (SSO button only)
 *  - `auto` (default) hide it when SSO is configured and no active account has a password,
 *           i.e. when the form could not sign anyone in anyway
 *
 * This only decides what the page renders. Password sign-in itself stays available for
 * accounts that have a password, and `/login?local=1` always shows the form (break-glass
 * path for a locked-out admin, e.g. when the IdP is down). Without SSO the form is
 * always shown: hiding the only sign-in method would lock everyone out.
 */
export type PasswordLoginMode = "auto" | "on" | "off";

export function passwordLoginMode(raw: string | undefined | null): PasswordLoginMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "on" || v === "true" || v === "1" || v === "yes") return "on";
  if (v === "off" || v === "false" || v === "0" || v === "no") return "off";
  return "auto";
}

export function showPasswordForm(input: {
  mode: PasswordLoginMode;
  ssoEnabled: boolean;
  /** At least one active account has a password set. */
  hasPasswordAccounts: boolean;
  /** `?local=1` on the login URL. */
  breakGlass: boolean;
}): boolean {
  if (!input.ssoEnabled || input.breakGlass) return true;
  if (input.mode === "on") return true;
  if (input.mode === "off") return false;
  return input.hasPasswordAccounts;
}

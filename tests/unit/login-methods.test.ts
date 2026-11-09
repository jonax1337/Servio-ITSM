import { describe, expect, it } from "vitest";
import { passwordLoginMode, showPasswordForm } from "@/lib/login-methods";

describe("passwordLoginMode", () => {
  it("defaults to auto and understands on/off spellings", () => {
    expect(passwordLoginMode(undefined)).toBe("auto");
    expect(passwordLoginMode("")).toBe("auto");
    expect(passwordLoginMode("nonsense")).toBe("auto");
    expect(passwordLoginMode("ON")).toBe("on");
    expect(passwordLoginMode("true")).toBe("on");
    expect(passwordLoginMode(" off ")).toBe("off");
    expect(passwordLoginMode("false")).toBe("off");
  });
});

describe("showPasswordForm", () => {
  const base = { ssoEnabled: true, hasPasswordAccounts: false, breakGlass: false };

  it("auto hides the form for an SSO-only install and shows it once a password account exists", () => {
    expect(showPasswordForm({ ...base, mode: "auto" })).toBe(false);
    expect(showPasswordForm({ ...base, mode: "auto", hasPasswordAccounts: true })).toBe(true);
  });

  it("on always shows it, off always hides it (with SSO)", () => {
    expect(showPasswordForm({ ...base, mode: "on" })).toBe(true);
    expect(showPasswordForm({ ...base, mode: "off", hasPasswordAccounts: true })).toBe(false);
  });

  it("never hides the only sign-in method: without SSO the form is always shown", () => {
    for (const mode of ["auto", "on", "off"] as const) {
      expect(showPasswordForm({ ...base, mode, ssoEnabled: false })).toBe(true);
    }
  });

  it("the break-glass flag shows the form in every mode", () => {
    for (const mode of ["auto", "on", "off"] as const) {
      expect(showPasswordForm({ ...base, mode, breakGlass: true })).toBe(true);
    }
  });
});

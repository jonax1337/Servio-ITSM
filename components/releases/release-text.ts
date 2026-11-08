import type { ReleaseBlocker, ReleaseReadiness } from "@/lib/release-rules";
import type { EnumTranslator } from "@/lib/i18n/enums";
import type { Translator } from "@/lib/i18n/translate";
import { CHANGE_STATUS_META } from "@/lib/constants";

/**
 * Release wording in the viewer's language — the localized counterparts of the English
 * sentences in lib/release-rules.ts (which stay English for server errors and tests).
 */
export function readinessText({ active, approved, blockers }: ReleaseReadiness, t: Translator<"releases">): string {
  if (active === 0) return t("readiness.empty");
  if (blockers.length === 0) return t("readiness.allApproved", { count: active });
  return t("readiness.partial", { approved, active, blocked: blockers.length });
}

export function blockerText(blocker: ReleaseBlocker, t: Translator<"releases">, te: EnumTranslator): string {
  return t("readiness.blocker", {
    status: te(CHANGE_STATUS_META, blocker.status),
    reason: t.dyn(`readiness.reason.${blocker.status}`, undefined, blocker.reason),
  });
}

/** "The bundle can't be changed…" for a release whose bundle is locked. */
export function bundleLockedText(status: string, t: Translator<"releases">, statusLabel: string): string {
  return status === "READY" ? t("bundle.ready") : t("bundle.locked", { status: statusLabel });
}

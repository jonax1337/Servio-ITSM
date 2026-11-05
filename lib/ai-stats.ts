import { db } from "@/lib/db";
import { getSetting, settingIsSet } from "@/lib/settings";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";

/**
 * Pure Prisma aggregation helpers for the Admin-Sable assistant. No "use server";
 * these are plain async functions the admin tools call. Every return is JSON-safe
 * (numbers and strings only) so it can flow straight back through the ai-sdk tool
 * result and into a proposal-free "read" answer.
 *
 * Never expose secret setting values — getSettingsOverview reports only whether a
 * secret is configured, never its contents.
 */

export type StatRow = { label: string; value: number };
export type StatisticsResult =
  | { ok: true; metric: string; rows: StatRow[] }
  | { ok: false; error: string };

export type StatisticsParams = {
  metric: string;
  groupBy?: string;
  timeframeDays?: number;
};

/** Resolve a group of ticket rows keyed by an id column into label/value rows. */
async function labelGroupsByGroup(
  groups: { groupId: string | null; _count: { _all: number } }[],
): Promise<StatRow[]> {
  const ids = groups.map((g) => g.groupId).filter((x): x is string => !!x);
  const names = ids.length
    ? await db.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  return groups.map((g) => ({
    label: g.groupId ? nameById.get(g.groupId) ?? "(unknown)" : "(unassigned)",
    value: g._count._all,
  }));
}

async function labelGroupsByCategory(
  groups: { categoryId: string | null; _count: { _all: number } }[],
): Promise<StatRow[]> {
  const ids = groups.map((g) => g.categoryId).filter((x): x is string => !!x);
  const names = ids.length
    ? await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  return groups.map((g) => ({
    label: g.categoryId ? nameById.get(g.categoryId) ?? "(unknown)" : "(uncategorised)",
    value: g._count._all,
  }));
}

function sinceDate(timeframeDays?: number): Date {
  const days = Number.isFinite(timeframeDays) && (timeframeDays as number) > 0 ? (timeframeDays as number) : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Compute a single statistics metric. See the JSDoc on each `case` for the exact
 * aggregation. Returns { ok:false, error } for an unknown metric.
 */
export async function getStatistics(params: StatisticsParams): Promise<StatisticsResult> {
  const { metric, groupBy, timeframeDays } = params;
  try {
    switch (metric) {
      case "tickets_by_status": {
        const g = await db.ticket.groupBy({ by: ["status"], _count: { _all: true } });
        return { ok: true, metric, rows: g.map((r) => ({ label: r.status, value: r._count._all })) };
      }
      case "tickets_by_priority": {
        const g = await db.ticket.groupBy({ by: ["priority"], _count: { _all: true } });
        return { ok: true, metric, rows: g.map((r) => ({ label: r.priority, value: r._count._all })) };
      }
      case "tickets_by_team": {
        const g = await db.ticket.groupBy({ by: ["groupId"], _count: { _all: true } });
        return { ok: true, metric, rows: await labelGroupsByGroup(g) };
      }
      case "tickets_by_category": {
        const g = await db.ticket.groupBy({ by: ["categoryId"], _count: { _all: true } });
        return { ok: true, metric, rows: await labelGroupsByCategory(g) };
      }
      case "open_tickets": {
        const value = await db.ticket.count({
          where: { status: { in: [...OPEN_TICKET_STATUSES] } },
        });
        return { ok: true, metric, rows: [{ label: "open", value }] };
      }
      case "tickets_created": {
        const since = sinceDate(timeframeDays);
        if (groupBy === "day") {
          const rows = await db.ticket.findMany({
            where: { createdAt: { gte: since } },
            select: { createdAt: true },
          });
          const byDay = new Map<string, number>();
          for (const r of rows) {
            const key = r.createdAt.toISOString().slice(0, 10);
            byDay.set(key, (byDay.get(key) ?? 0) + 1);
          }
          const dayRows = [...byDay.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([label, value]) => ({ label, value }));
          return { ok: true, metric, rows: dayRows };
        }
        const value = await db.ticket.count({ where: { createdAt: { gte: since } } });
        return { ok: true, metric, rows: [{ label: "created", value }] };
      }
      case "tickets_resolved": {
        const since = sinceDate(timeframeDays);
        const value = await db.ticket.count({ where: { resolvedAt: { gte: since } } });
        return { ok: true, metric, rows: [{ label: "resolved", value }] };
      }
      case "sla_breaches": {
        // SLA deadline fields on Ticket (verified against schema): responseDueAt +
        // firstResponseAt for response, resolveDueAt + resolvedAt for resolution.
        const now = new Date();
        const value = await db.ticket.count({
          where: {
            OR: [
              { responseDueAt: { lt: now }, firstResponseAt: null },
              { resolveDueAt: { lt: now }, resolvedAt: null },
            ],
          },
        });
        return { ok: true, metric, rows: [{ label: "breaches", value }] };
      }
      case "users_by_role": {
        const g = await db.user.groupBy({ by: ["role"], _count: { _all: true } });
        return { ok: true, metric, rows: g.map((r) => ({ label: r.role, value: r._count._all })) };
      }
      case "counts_overview": {
        const [tickets, problems, changes, users, groups, services, categories, slas, articles] =
          await Promise.all([
            db.ticket.count(),
            db.problem.count(),
            db.change.count(),
            db.user.count(),
            db.group.count(),
            db.service.count(),
            db.category.count(),
            db.sLA.count(),
            db.article.count(),
          ]);
        return {
          ok: true,
          metric,
          rows: [
            { label: "tickets", value: tickets },
            { label: "problems", value: problems },
            { label: "changes", value: changes },
            { label: "users", value: users },
            { label: "groups", value: groups },
            { label: "services", value: services },
            { label: "categories", value: categories },
            { label: "slas", value: slas },
            { label: "articles", value: articles },
          ],
        };
      }
      default:
        return { ok: false, error: "Unknown metric" };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to compute statistics" };
  }
}

export type SettingsOverviewRow = { key: string; value: string; isSet: boolean };
export type SettingsOverview = { rows: SettingsOverviewRow[] };

/** Non-secret setting keys whose values are safe to display. */
const SHOWN_SETTING_KEYS = [
  "APP_NAME",
  "APP_URL",
  "AI_PROVIDER",
  "AI_MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "AI_MAX_OUTPUT_TOKENS",
  "AI_ALLOW_EXTERNAL",
  "AI_TEASER",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_FROM",
  "MAX_UPLOAD_MB",
] as const;

/** Secret keys — never read the value; only report whether configured. */
const SECRET_SETTING_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "SMTP_PASS",
  "SETTINGS_ENCRYPTION_KEY",
] as const;

/**
 * A settings snapshot for the admin assistant. NON-SECRET keys show their value;
 * secret keys show only "(set)"/"(not set)" — never the secret itself.
 */
export async function getSettingsOverview(): Promise<SettingsOverview> {
  const shown = await Promise.all(
    SHOWN_SETTING_KEYS.map(async (key) => {
      const v = await getSetting(key);
      return { key, value: v ?? "(not set)", isSet: v !== null && v !== "" };
    }),
  );
  const secrets = await Promise.all(
    SECRET_SETTING_KEYS.map(async (key) => {
      const set = await settingIsSet(key);
      return { key, value: set ? "(set)" : "(not set)", isSet: set };
    }),
  );
  return { rows: [...shown, ...secrets] };
}

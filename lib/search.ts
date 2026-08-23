import type { Prisma } from "@prisma/client";

/**
 * Cross-field ticket search.
 *
 * Builds a `Prisma.TicketWhereInput` that matches a free-text query across
 * several fields at once (title, description, comment bodies, the requester's
 * name/email, and the serialised custom-field JSON) instead of the old
 * title-only `contains`.
 *
 * Provider-portable: SQLite's default `LIKE` is already case-insensitive for
 * ASCII and rejects Prisma's `mode` flag, so the SQLite path uses plain
 * `contains`. On Postgres `contains` is case-sensitive — there we add
 * `mode: "insensitive"` so behaviour matches across the dev/prod switch
 * (`containsClause` below). A native FTS index remains the long-term answer
 * (see below).
 *
 * NOTE (deferred): a native full-text index — SQLite FTS5 or a Postgres
 * `tsvector`/`GIN` column — would supersede this OR-of-LIKEs approach with
 * proper ranking and case-folding. We do the cross-field OR now because it is
 * schema-free and works on both engines today.
 */

/** Fields we scan for a free-text ticket query. */
export type TicketSearchField =
  | "title"
  | "description"
  | "comments"
  | "requester"
  | "customFields";

const ALL_FIELDS: readonly TicketSearchField[] = [
  "title",
  "description",
  "comments",
  "requester",
  "customFields",
] as const;

export type TicketSearchOptions = {
  /** Restrict the scan to a subset of fields. Defaults to all of them. */
  fields?: readonly TicketSearchField[];
  /**
   * If the query is a bare number, also match on the ticket id so that
   * "123" finds ticket #123. Defaults to `true`.
   */
  matchId?: boolean;
};

/**
 * Case-insensitive `contains` clause. SQLite (default `file:` URL) keeps plain
 * `contains` — it is already CI and rejects `mode`. A Postgres
 * `DATABASE_URL` opts into `mode: "insensitive"`, whose filter type the
 * sqlite-generated client does not declare, hence the narrow cast.
 */
function containsClause(q: string): Prisma.StringFilter {
  if (/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? "")) {
    return { contains: q, mode: "insensitive" } as Prisma.StringFilter;
  }
  return { contains: q };
}

/**
 * Turn a raw query string into a set of OR'd `contains` clauses spanning the
 * chosen fields. Returns `undefined` for an empty/blank query so callers can
 * skip merging it into their `where`.
 */
export function ticketSearchWhere(
  raw: string | null | undefined,
  opts: TicketSearchOptions = {},
): Prisma.TicketWhereInput | undefined {
  const q = (raw ?? "").trim();
  if (!q) return undefined;

  const fields = opts.fields ?? ALL_FIELDS;
  const matchId = opts.matchId ?? true;
  const OR: Prisma.TicketWhereInput[] = [];

  for (const field of fields) {
    switch (field) {
      case "title":
        OR.push({ title: containsClause(q) });
        break;
      case "description":
        OR.push({ description: containsClause(q) });
        break;
      case "comments":
        // `comments` is a one-to-many relation (TicketComment.body is the
        // plaintext twin used for search) — `some` keeps this a single query.
        OR.push({ comments: { some: { body: containsClause(q) } } });
        break;
      case "requester":
        OR.push({ requester: { is: { name: containsClause(q) } } });
        OR.push({ requester: { is: { email: containsClause(q) } } });
        break;
      case "customFields":
        // Custom-field answers live in the `customFields` JSON *string*
        // column; a substring match against the serialised JSON finds any
        // field value (or key) without needing to know the schema.
        OR.push({ customFields: containsClause(q) });
        break;
    }
  }

  if (matchId) {
    const idNum = ticketIdFromQuery(q);
    if (idNum !== null) OR.push({ id: idNum });
  }

  return { OR };
}

/**
 * Parse a bare ticket id out of a query. Accepts a plain number or a
 * prefixed ref like "INC-123"/"REQ 42" — returns the numeric part, or `null`
 * when the query is not id-shaped (so we don't turn "openssl" into id 0).
 */
export function ticketIdFromQuery(raw: string): number | null {
  const q = (raw ?? "").trim();
  if (!q) return null;
  // Only treat it as an id if it's a number optionally behind a short prefix,
  // e.g. "123", "#123", "INC-123", "REQ 42".
  const m = q.match(/^#?(?:[A-Za-z]{1,6}[-\s]?)?(\d{1,9})$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Merge a cross-field text search into an existing ticket `where`. Combines
 * with any pre-existing filters via `AND` so the search narrows (rather than
 * replaces) the active filters. Mutates and returns `where` for convenience.
 */
export function applyTicketSearch(
  where: Prisma.TicketWhereInput,
  raw: string | null | undefined,
  opts?: TicketSearchOptions,
): Prisma.TicketWhereInput {
  const search = ticketSearchWhere(raw, opts);
  if (!search) return where;
  const existingAnd = where.AND
    ? Array.isArray(where.AND)
      ? where.AND
      : [where.AND]
    : [];
  where.AND = [...existingAnd, search];
  return where;
}

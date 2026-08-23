/**
 * Test-bootstrap: deterministic env before any module under test loads.
 * DATABASE_URL points at a (never touched) file so importing lib/db — which
 * some module graphs pull in transitively — can construct a PrismaClient
 * without connecting. The suite never queries.
 */
process.env.DATABASE_URL ??= "file:./tests/vitest-placeholder.db";
process.env.SETTINGS_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

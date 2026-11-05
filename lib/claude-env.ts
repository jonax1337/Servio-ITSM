/**
 * The host environment the Claude Code CLI subprocess may inherit. The CLI
 * expands `${VAR}` in MCP server configs from its own environment, and nothing
 * of Servio's own configuration (DATABASE_URL, AUTH_SECRET,
 * SETTINGS_ENCRYPTION_KEY, provider keys, ...) belongs in there — so instead of
 * scrubbing known secrets, only what a process needs to run is passed on. The
 * selected backend's own variables are set explicitly on top (lib/ai.ts).
 */
const INHERITED_VARS = new Set(
  [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
    "WINDIR",
    "LANG",
    "LC_ALL",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
  ],
);

/**
 * The allowlisted subset of `source`. Names compare case-insensitively, which
 * covers Windows spellings (`Path`, `SystemRoot`, `ComSpec`) and the lowercase
 * proxy variables (`https_proxy`).
 */
export function inheritedHostEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => INHERITED_VARS.has(name.toUpperCase())));
}

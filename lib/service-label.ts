/** A service as pickers and lists name it: "S-01 · Email" with a service number, else just the name. Pure, client-safe. */
export function serviceLabel(s: { name: string; code?: string | null }): string {
  return s.code ? `${s.code} · ${s.name}` : s.name;
}

"use client";

import { useSable } from "./sable-provider";
import { SableFab } from "./sable-chrome";
import { usePathname } from "next/navigation";

/**
 * The always-present floating action button (bottom-right). Re-opens Sable in
 * the state it was last left in (min or max) with the last conversation
 * restored. Hidden whenever a window is already on screen. Shares its look with
 * the portal launcher via <SableFab>.
 */
export function SableLauncher() {
  const sable = useSable();
  const pathname = usePathname();
  if (sable.state !== "closed" || pathname === "/assistant") return null;
  return <SableFab beta onClick={sable.openLast} />;
}

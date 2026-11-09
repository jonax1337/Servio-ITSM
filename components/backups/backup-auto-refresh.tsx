"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the (dynamic) page every few seconds while a backup is running. */
export function BackupAutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

"use client";

import { useT } from "@/lib/i18n/client";

/** Three bouncing dots shown while Sable is generating a reply. */
export function TypingDots() {
  const t = useT("assistant");
  return (
    <span className="inline-flex items-center gap-1" aria-label={t("thread.typing")}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-sable motion-reduce:animate-none"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

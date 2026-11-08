"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { ComboOption } from "@/components/combobox";
import { UserAvatar } from "@/components/user-avatar";
import { useT } from "@/lib/i18n/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One recipient line (To / Cc / Bcc) — chips for the current recipients plus a
 * typeahead that suggests known users and accepts free email addresses. Value is
 * a comma-joined list of EMAILS written to a hidden input (`name`). Users are
 * passed as ComboOptions where `value` is the email and `label` is the name.
 */
export function RecipientField({
  name,
  label,
  users,
  defaultEmails = [],
  autoFocus = false,
}: {
  name: string;
  label: string;
  users: ComboOption[];
  defaultEmails?: string[];
  autoFocus?: boolean;
}) {
  const [emails, setEmails] = useState<string[]>(() => uniq(defaultEmails.map((e) => e.toLowerCase())));
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const t = useT("tickets");

  const labelFor = useMemo(() => new Map(users.map((u) => [u.value.toLowerCase(), u.label])), [users]);
  const q = input.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [];
    return users
      .filter((u) => !emails.includes(u.value.toLowerCase()))
      .filter((u) => u.label.toLowerCase().includes(q) || u.value.toLowerCase().includes(q))
      .slice(0, 6);
  }, [q, users, emails]);

  function add(email: string) {
    const v = email.trim().toLowerCase().replace(/[,;]+$/, "");
    if (EMAIL_RE.test(v) && !emails.includes(v)) setEmails((s) => [...s, v]);
    setInput("");
    setOpen(false);
  }
  function remove(email: string) {
    setEmails((s) => s.filter((x) => x !== email));
  }

  return (
    <div className="flex items-start gap-2">
      <span className="w-9 shrink-0 pt-1.5 text-xs font-medium text-muted-foreground">{label}</span>
      <input type="hidden" name={name} value={emails.join(",")} />
      <div className="relative flex-1">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-background px-1.5 py-1">
          {emails.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium" title={e}>
              {labelFor.get(e) ?? e}
              <button type="button" aria-label={t("attachments.remove", { name: e })} onClick={() => remove(e)} className="text-muted-foreground hover:text-foreground">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={input}
            autoFocus={autoFocus}
            onChange={(e) => { setInput(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === "," || e.key === ";") && input.trim()) {
                e.preventDefault();
                if (matches[0]) add(matches[0].value);
                else add(input);
              } else if (e.key === "Backspace" && !input && emails.length) {
                remove(emails[emails.length - 1]);
              }
            }}
            placeholder={emails.length ? "" : t("comments.nameOrEmail")}
            className="min-w-32 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {open && matches.length > 0 ? (
          <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
            {matches.map((m) => (
              <button
                key={m.value}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); add(m.value); }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted"
              >
                <UserAvatar name={m.label} email={m.value} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.value}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function uniq(arr: string[]) {
  return [...new Set(arr.filter(Boolean))];
}

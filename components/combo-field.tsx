"use client";

import { useState } from "react";
import { Combobox, type ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

/**
 * A form-friendly searchable combobox: manages its own state and submits via a
 * hidden input (`name`), so it drops into native <form>/useActionState forms in
 * place of a <Select name=…>.
 */
export function ComboField({
  name,
  options,
  defaultValue,
  placeholder,
  includeNone = false,
  noneLabel,
  size = "default",
  disabled,
}: {
  name: string;
  options: ComboOption[];
  defaultValue?: string;
  placeholder?: string;
  includeNone?: boolean;
  noneLabel?: string;
  size?: "default" | "sm";
  disabled?: boolean;
}) {
  const t = useT("components");
  const initial = defaultValue ?? (includeNone ? "none" : options[0]?.value ?? "");
  const [value, setValue] = useState(initial);
  const opts: ComboOption[] = includeNone
    ? [{ value: "none", label: noneLabel ?? t("combo.none") }, ...options]
    : options;
  return (
    <Combobox
      name={name}
      options={opts}
      value={value}
      onChange={setValue}
      placeholder={placeholder}
      searchPlaceholder={t("combo.search")}
      size={size}
      disabled={disabled}
    />
  );
}

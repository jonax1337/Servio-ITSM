import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseFormSchema } from "@/lib/service-forms";
import { getT } from "@/lib/i18n/server";

function humanize(key: string) {
  const s = key.replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] sm:gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap font-medium">{value}</span>
    </div>
  );
}

/** Render catalog-form answers as a structured form (not a text dump). Server Component (console + portal). */
export async function FormAnswers({
  formSchema, formData, className,
}: {
  formSchema: string | null | undefined;
  formData: string | null | undefined;
  className?: string;
}) {
  if (!formData) return null;
  let values: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(formData);
    if (!parsed || typeof parsed !== "object") return null;
    values = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const [t, tc] = await Promise.all([getT("tickets"), getT("common")]);
  const yesNo = (v: unknown) => (v ? tc("yes") : tc("no"));
  const fields = parseFormSchema(formSchema);
  // Fallback: no schema (item deleted / legacy ticket) → show raw key/value pairs
  // rather than silently dropping the answers.
  const rows =
    fields.length > 0
      ? fields.map((f) => {
          const v = values[f.key];
          return { label: f.label, value: f.type === "checkbox" ? yesNo(v) : v == null || v === "" ? "—" : String(v) };
        })
      : Object.entries(values).map(([k, v]) => ({ label: humanize(k), value: typeof v === "boolean" ? yesNo(v) : v == null || v === "" ? "—" : String(v) }));

  if (rows.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="size-4 text-muted-foreground" />
          {t("formAnswers.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid divide-y py-0 text-sm">
        {rows.map((r, i) => <Row key={i} label={r.label} value={r.value} />)}
      </CardContent>
    </Card>
  );
}

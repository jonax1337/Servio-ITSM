import Link from "next/link";
import { FileStack, Settings2, X } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { LinkButton } from "@/components/link-button";
import { isPreAuthorized } from "@/lib/change-template-rules";
import { CHANGE_TYPE_META } from "@/lib/constants";

export type PickableTemplate = {
  id: string;
  name: string;
  summary: string | null;
  type: string;
  serviceName: string | null;
};

/**
 * "New from template" on /changes/new: pick a template to prefill the form, or see the
 * chosen one with a way back. Managers also get a link to manage the templates.
 */
export function TemplatePicker({
  templates,
  selected,
  canManage,
}: {
  templates: PickableTemplate[];
  selected: PickableTemplate | undefined;
  canManage: boolean;
}) {
  if (templates.length === 0 && !canManage) return null;

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <FileStack className="size-4 text-primary" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium">From template “{selected.name}”</span>
          <span className="text-xs text-muted-foreground">
            {isPreAuthorized(selected.type)
              ? "A standard change: it is pre-approved right away, without CAB review, unless its window falls in a change freeze."
              : "A normal change: it goes through CAB review once submitted."}
          </span>
        </div>
        <LinkButton href="/changes/new" variant="ghost" size="sm">
          <X className="size-4" /> Start blank
        </LinkButton>
      </div>
    );
  }

  return (
    <section aria-labelledby="template-picker-title" className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="template-picker-title" className="text-sm font-medium">
          Start from a template
        </h2>
        {canManage ? (
          <LinkButton href="/changes/templates" variant="ghost" size="sm">
            <Settings2 className="size-4" /> Manage templates
          </LinkButton>
        ) : null}
      </div>
      {templates.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No templates yet. Use Manage templates to create one for work that repeats.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/changes/new?template=${t.id}`}
                className="grid h-full gap-1.5 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-medium">{t.name}</span>
                  <StatusBadge map={CHANGE_TYPE_META} value={t.type} dot />
                </span>
                {t.summary ? <span className="line-clamp-2 text-xs text-muted-foreground">{t.summary}</span> : null}
                {t.serviceName ? <span className="text-xs text-muted-foreground">Service: {t.serviceName}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

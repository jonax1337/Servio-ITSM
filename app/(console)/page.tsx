import { getSessionUser, hasRole, isAgent, type Role } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { getVisibleDashboards, ensurePersonalDashboard } from "@/lib/board-service";
import { computeWidget } from "@/lib/dashboard/compute";
import { DEFAULT_LAYOUT, type Widget, type Computed } from "@/lib/dashboard/types";
import { DashboardPicker } from "@/components/dashboard/dashboard-picker";
import { DashboardCanvas } from "@/components/dashboard/dashboard-canvas";
import { DashboardGridView } from "@/components/dashboard/dashboard-grid-view";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { buttonVariants } from "@/components/ui/button";
import { getParam, type SearchParams } from "@/lib/query";
import { Pencil, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const dashboardId = getParam(sp, "dashboard");
  const me = await getSessionUser();

  // Everyone gets an editable personal "My Dashboard" (created on first visit).
  if (me) await ensurePersonalDashboard(me.id);

  const [opts, dashboards] = await Promise.all([
    getFormOptions(),
    me ? getVisibleDashboards(me.id) : Promise.resolve([]),
  ]);

  // Active = the one in the URL, else the user's personal dashboard, else the first.
  const active =
    (dashboardId ? dashboards.find((d) => d.id === dashboardId) : null) ??
    dashboards.find((d) => d.ownerId === me?.id && !d.isShared && d.name === "My Dashboard") ??
    dashboards.find((d) => d.ownerId === me?.id && !d.isShared) ??
    dashboards[0] ??
    null;
  const activeId = active?.id ?? "";
  let layout: Widget[] = DEFAULT_LAYOUT;
  if (active) {
    try {
      const parsed = JSON.parse(active.layout);
      if (Array.isArray(parsed) && parsed.length) layout = parsed as Widget[];
    } catch {
      /* fall back to default */
    }
  }

  const editable =
    !!active && !!me && (active.ownerId === me.id || (active.isShared && hasRole(me.role as Role, "MANAGER")));
  const editing = getParam(sp, "edit") === "1" && editable && !!active;

  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const computed = await Promise.all(ordered.map((w) => computeWidget(w)));
  const dataById: Record<string, Computed> = {};
  ordered.forEach((w, i) => (dataById[w.id] = computed[i]));

  // ── Edit mode: the interactive drag/resize canvas ──
  if (editing && active) {
    const editorOptions = {
      agents: opts.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
      groups: opts.groups.map((g) => ({ value: g.id, label: g.name })),
      categories: opts.categories.map((c) => ({ value: c.id, label: c.name })),
      services: opts.services.map((s) => ({ value: s.id, label: s.name })),
    };
    return (
      <PageBody className="grid gap-4">
        <DashboardCanvas
          dashboardId={active.id}
          dashboardName={active.name}
          dashboardIsShared={active.isShared}
          dashboardGroupId={active.groupId}
          canManageShared={!!me && hasRole(me.role as Role, "MANAGER")}
          teams={opts.groups.map((g) => ({ value: g.id, label: g.name }))}
          initialWidgets={ordered}
          dataById={dataById}
          options={editorOptions}
        />
      </PageBody>
    );
  }

  // ── View mode: read-only widget grid + picker ──
  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${me?.name?.split(" ")[0] ?? "there"}`}
        description="Your service desk at a glance — pick or build a dashboard."
      >
        {me && isAgent(me.role) ? (
          <a
            href="/api/export?type=tickets"
            download
            title="Export tickets as CSV"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <Download className="size-4" /> Export CSV
          </a>
        ) : null}
        <LinkButton href="/tickets/new">New ticket</LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DashboardPicker
            dashboards={dashboards}
            activeId={activeId}
            currentUserId={me?.id ?? ""}
            canManageShared={!!me && hasRole(me.role as Role, "MANAGER")}
            teams={opts.groups.map((g) => ({ value: g.id, label: g.name }))}
          />
          {editable ? (
            <LinkButton href={`/?dashboard=${activeId}&edit=1`} variant="outline" size="sm">
              <Pencil className="size-4" /> Edit
            </LinkButton>
          ) : null}
        </div>

        <DashboardGridView widgets={ordered} dataById={dataById} />
      </PageBody>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

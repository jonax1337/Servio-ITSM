import { requireRole, hasRole } from "@/lib/session";
import { db } from "@/lib/db";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { SableProvider } from "@/components/assistant/sable-provider";
import { SableMount } from "@/components/assistant/sable-mount";
import { MaintenanceBanner } from "@/components/maintenance/maintenance-banner";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("AGENT");
  const [notifications, configured, teaser] = await Promise.all([
    db.notification.count({ where: { userId: user.id, read: false } }),
    aiConfigured(),
    aiTeaserEnabled(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar role={user.role} />
      {/* Split-pane pages ([data-viewport-pane]) fill the viewport below the topbar
          and any banner and scroll their own panes, so the inset is locked to the
          viewport for them; every other page keeps normal window scrolling. */}
      <SidebarInset className="min-w-0 lg:has-data-viewport-pane:h-svh lg:has-data-viewport-pane:overflow-hidden">
        <SableProvider>
          <AppTopbar
            user={{
              name: user.name,
              email: user.email,
              role: user.role,
              image: user.image,
            }}
            notifications={notifications}
            sableEnabled={configured || teaser}
          />
          <MaintenanceBanner role={user.role} />
          {/* Not a <main>: SidebarInset already renders the page's single main landmark. */}
          <div className="min-h-0 min-w-0 flex-1">{children}</div>
          <SableMount
            configured={configured}
            teaser={teaser}
            isAdmin={hasRole(user.role, "ADMIN")}
          />
        </SableProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}

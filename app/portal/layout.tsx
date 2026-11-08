import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { requireUser, isAgent } from "@/lib/session";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { Wordmark } from "@/components/brand";
import { PortalNav } from "@/components/portal/portal-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { LinkButton } from "@/components/link-button";
import { SableWidget } from "@/components/portal/sable-widget";
import { PortalStatusBanner } from "@/components/portal/portal-status-banner";
import { MaintenanceBanner } from "@/components/maintenance/maintenance-banner";
import { getT } from "@/lib/i18n/server";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [configured, teaser] = await Promise.all([aiConfigured(), aiTeaserEnabled()]);
  const showSable = configured || teaser;
  const t = await getT("portal");

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65">
        {/* Three equal-flex columns so the centre nav stays truly centred
            regardless of how wide the left/right clusters are. */}
        <div className="mx-auto grid h-16 w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4">
          <div className="flex items-center">
            <Link href="/portal" className="shrink-0 transition-opacity hover:opacity-80">
              <Wordmark />
            </Link>
          </div>
          <div className="hidden lg:flex lg:justify-center">
            <PortalNav />
          </div>
          <div className="flex items-center justify-end gap-1.5">
            {isAgent(user.role) ? (
              <LinkButton href="/" variant="outline" size="sm" className="hidden sm:inline-flex">
                <LayoutDashboard className="size-4" /> {t("agentConsole")}
              </LinkButton>
            ) : null}
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} role={user.role} image={user.image} />
          </div>
        </div>
        <div className="border-t px-2 py-2 lg:hidden">
          <PortalNav />
        </div>
      </header>

      <MaintenanceBanner role={user.role} containerClassName="mx-auto max-w-6xl" />
      <PortalStatusBanner />

      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-8 sm:py-10">{children}</main>

      <footer className="mt-4 border-t">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
          <p>
            {t("footerPrompt")}{" "}
            <Link href="/portal/new" className="font-medium text-primary hover:underline">
              {t("contactServiceDesk")}
            </Link>
          </p>
        </div>
      </footer>

      {showSable ? (
        <SableWidget firstName={user.name?.split(" ")[0] ?? t("there")} previewOnly={!configured} />
      ) : null}
    </div>
  );
}

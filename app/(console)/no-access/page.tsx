import type { Metadata } from "next";
import { ShieldAlert, LayoutDashboard } from "lucide-react";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { requiredRoleFor } from "@/lib/route-guard";
import type { SearchParams } from "@/lib/query";
import { getParam } from "@/lib/query";
import { ROLE_META } from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("errors");
  return { title: t("noAccessTitle") };
}
export const dynamic = "force-dynamic";

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Re-check against the live DB user (role/isActive), never the stale JWT.
  const user = await requireUser();
  const sp = await searchParams;
  const from = getParam(sp, "from");
  const required = from ? requiredRoleFor(from) : null;
  const [t, te] = await Promise.all([getT("errors"), getEnumT()]);
  const roleLabel = (role: string) => te(ROLE_META as Record<string, { label: string }>, role);

  return (
    <>
      <PageHeader
        icon={ShieldAlert}
        title={t("accessRestricted")}
        description={t("accessRestrictedText")}
      />

      <PageBody>
        <EmptyState
          icon={ShieldAlert}
          title={t("cantAccess")}
          description={
            required
              ? t("limitedToRole", { required: roleLabel(required), role: roleLabel(user.role) })
              : t("roleNoPermission", { role: roleLabel(user.role) })
          }
        >
          {from ? (
            <p className="rounded-md border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              {from}
            </p>
          ) : null}
          <LinkButton href="/" variant="outline" size="sm" className="mt-1">
            <LayoutDashboard className="size-4" />
            {t("backToDashboard")}
          </LinkButton>
        </EmptyState>
      </PageBody>
    </>
  );
}

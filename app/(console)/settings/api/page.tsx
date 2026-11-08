import { KeyRound, Ban } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { tokenExpired } from "@/lib/token-rules";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { ToneBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TokenManager } from "@/components/settings/token-manager";
import { revokeApiToken } from "@/lib/actions/tokens";
import { getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("api.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function ApiTokensPage() {
  const me = await requireRole("ADMIN");
  const [t, f] = await Promise.all([getT("settings"), getFormatter()]);

  const [tokens, owners] = await Promise.all([
    db.apiToken.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: { user: { select: { name: true, email: true } } },
    }),
    db.user.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        icon={KeyRound}
        title={t("api.title")}
        description={t("api.description")}
      >
        <LinkButton href="/settings" variant="outline">
          {t("api.back")}
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-medium">{t("api.generateTitle")}</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t("api.generateHint")}
          </p>
          <TokenManager
            currentUserId={me.id}
            owners={owners.map((u) => ({ value: u.id, label: `${u.name ?? u.email} · ${u.role}` }))}
          />
        </div>

        {tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("api.emptyTitle")}
            description={t("api.emptyDescription")}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("api.colName")}</TableHead>
                  <TableHead>{t("api.colPrefix")}</TableHead>
                  <TableHead>{t("api.colScopes")}</TableHead>
                  <TableHead>{t("api.colOwner")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("api.colExpires")}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("api.colLastUsed")}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">{t("api.colCreated")}</TableHead>
                  <TableHead className="text-right">{t("api.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((tok) => (
                  <TableRow key={tok.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{tok.name}</span>
                        {tok.revoked ? (
                          <ToneBadge
                            meta={{ label: t("api.revoked"), tone: "danger" }}
                          />
                        ) : tokenExpired(tok.expiresAt) ? (
                          <ToneBadge meta={{ label: t("api.expired"), tone: "warning" }} />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {tok.prefix}…
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {tok.scopes.split(",").map((s) => (
                          <ToneBadge
                            key={s}
                            meta={{ label: s, tone: "neutral" }}
                          />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {tok.user.name ?? tok.user.email}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {tok.expiresAt ? f.date(tok.expiresAt) : t("api.noExpiry")}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {tok.lastUsedAt ? f.relative(tok.lastUsedAt) : t("api.never")}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {f.relative(tok.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {tok.revoked ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <ConfirmButton
                          action={revokeApiToken}
                          fields={{ id: tok.id }}
                          title={t("api.revokeTitle")}
                          description={t("api.revokeDescription", { name: tok.name })}
                          confirmLabel={t("api.revoke")}
                          triggerVariant="ghost"
                          triggerSize="sm"
                          triggerClassName="text-muted-foreground hover:text-destructive"
                        >
                          <Ban className="size-3.5" /> {t("api.revoke")}
                        </ConfirmButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}

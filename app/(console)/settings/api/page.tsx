import { KeyRound, Ban } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
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
import { formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "API Tokens" };
export const dynamic = "force-dynamic";

export default async function ApiTokensPage() {
  await requireRole("ADMIN");

  const tokens = await db.apiToken.findMany({
    orderBy: [{ createdAt: "desc" }],
  });

  return (
    <>
      <PageHeader
        icon={KeyRound}
        title="API Tokens"
        description="Personal access tokens authenticate requests to the Servio REST API."
      >
        <LinkButton href="/settings" variant="outline">
          Back to settings
        </LinkButton>
      </PageHeader>

      <PageBody className="grid gap-4">
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-medium">Generate a token</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Give it a name and pick the scopes it should be allowed to use.
          </p>
          <TokenManager />
        </div>

        {tokens.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No tokens yet"
            description="Generate your first token above to start using the API."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead className="hidden md:table-cell">
                    Last used
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((t) => (
                  <TableRow key={t.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.name}</span>
                        {t.revoked ? (
                          <ToneBadge
                            meta={{ label: "Revoked", tone: "danger" }}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {t.prefix}…
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {t.scopes.split(",").map((s) => (
                          <ToneBadge
                            key={s}
                            meta={{ label: s, tone: "neutral" }}
                          />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {t.lastUsedAt
                        ? formatDistanceToNow(t.lastUsedAt, { addSuffix: true })
                        : "Never"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDistanceToNow(t.createdAt, { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.revoked ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <ConfirmButton
                          action={revokeApiToken}
                          fields={{ id: t.id }}
                          title="Revoke API token?"
                          description={`"${t.name}" will stop working immediately. This can't be undone.`}
                          confirmLabel="Revoke"
                          triggerVariant="ghost"
                          triggerSize="sm"
                          triggerClassName="text-muted-foreground hover:text-destructive"
                        >
                          <Ban className="size-3.5" /> Revoke
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

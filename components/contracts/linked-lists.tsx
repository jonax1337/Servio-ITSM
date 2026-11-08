import Link from "next/link";
import { FileSignature, KeyRound } from "lucide-react";
import { CONTRACT_STATUS_META } from "@/lib/constants";
import { licenseCompliance, type ContractTimeline } from "@/lib/contract-rules";
import { getT } from "@/lib/i18n/server";
import { formatDayIn } from "./contract-format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { ContractExpiryBadge, LicenseComplianceBadge } from "./contract-badges";

export type LinkedLicense = { id: string; name: string; seats: number; _count: { assignments: number } };
export type LinkedContract = ContractTimeline & { id: string; name: string };

const ROW = "flex flex-wrap items-center gap-2";
const ROW_LINK = "min-w-0 flex-1 truncate text-sm font-medium hover:text-primary";

/** The licenses tied to a contract or vendor, each with its seat compliance. */
export async function LinkedLicensesCard({ licenses, emptyText }: { licenses: LinkedLicense[]; emptyText: string }) {
  const t = await getT("contracts");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-muted-foreground" />
          {t("licensesCount", { count: licenses.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {licenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          licenses.map((l) => (
            <div key={l.id} className={ROW}>
              <Link href={`/contracts/licenses/${l.id}`} className={ROW_LINK}>{l.name}</Link>
              <LicenseComplianceBadge compliance={licenseCompliance(l.seats, l._count.assignments)} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** The contracts held with a vendor, with their end date and renewal warning. */
export async function LinkedContractsCard({ contracts, now, emptyText }: { contracts: LinkedContract[]; now: Date; emptyText: string }) {
  const t = await getT("contracts");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileSignature className="size-4 text-muted-foreground" />
          {t("contractsCount", { count: contracts.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          contracts.map((c) => (
            <div key={c.id} className={ROW}>
              <Link href={`/contracts/${c.id}`} className={ROW_LINK}>{c.name}</Link>
              <span className="text-xs tabular-nums text-muted-foreground">
                {c.endDate ? t("endsOn", { date: formatDayIn(t.locale, c.endDate) }) : t("noEndDateLower")}
              </span>
              <ContractExpiryBadge contract={c} now={now} />
              <StatusBadge map={CONTRACT_STATUS_META} value={c.status} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

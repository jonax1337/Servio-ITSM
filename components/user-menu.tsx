"use client";

import { useState } from "react";
import { LogOut, Settings, LifeBuoy, User } from "lucide-react";
import Link from "next/link";
import { doSignOut } from "@/lib/actions/auth";
import { AccountSettingsDialog } from "@/components/account/account-settings-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { ROLE_META } from "@/lib/constants";
import { useEnumT, useT } from "@/lib/i18n/client";

export function UserMenu({
  name,
  email,
  role,
  image,
}: {
  name: string;
  email: string;
  role: string;
  image?: string | null;
}) {
  // Mirror lib/session RANK without importing it (that module pulls in server-only
  // deps like Prisma, which must not land in this client bundle).
  const RANK: Record<string, number> = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 };
  const isManager = (RANK[role] ?? 0) >= RANK.MANAGER;
  const [accountOpen, setAccountOpen] = useState(false);
  const t = useT("shell");
  const te = useEnumT();
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <UserAvatar name={name} email={email} image={image} className="border" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="grid gap-0.5 px-2 py-1.5">
          <div className="flex items-center gap-2">
            <UserAvatar name={name} email={email} image={image} size="sm" className="border" />
            <div className="grid min-w-0">
              <span className="truncate text-sm font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </div>
          </div>
          <span className="mt-1 w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {ROLE_META[role as keyof typeof ROLE_META] ? te(ROLE_META, role) : role}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setAccountOpen(true)}>
          <User className="size-4" /> {t("accountSettings")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/portal" />}>
          <LifeBuoy className="size-4" /> {t("portal")}
        </DropdownMenuItem>
        {isManager ? (
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings className="size-4" /> {t("adminSettings")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <form action={doSignOut}>
          <DropdownMenuItem
            variant="destructive"
            closeOnClick={false}
            nativeButton
            render={<button type="submit" className="w-full" />}
          >
            <LogOut className="size-4" /> {t("signOut")}
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
    <AccountSettingsDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  );
}

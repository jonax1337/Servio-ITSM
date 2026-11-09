import { db } from "@/lib/db";
import { cache } from "react";

/** Option lists used to populate form selects & filters. */
export const getFormOptions = cache(async () => {
  const [agents, groups, categories, services, slas, memberships] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER", "AGENT"] }, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.category.findMany({
      where: { archived: false },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: "asc" },
    }),
    db.service.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    db.sLA.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.groupMember.findMany({ select: { groupId: true, userId: true } }),
  ]);
  // groupId → member user ids (used to restrict assignees to a group's members).
  const groupMembers: Record<string, string[]> = {};
  for (const m of memberships) (groupMembers[m.groupId] ??= []).push(m.userId);
  return { agents, groups, categories, services, slas, groupMembers };
});

export type FormOptions = Awaited<ReturnType<typeof getFormOptions>>;

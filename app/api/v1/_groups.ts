export const GROUP_DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  type: true,
  email: true,
  members: {
    orderBy: { user: { name: "asc" } },
    select: { role: true, user: { select: { id: true, name: true, email: true, isActive: true } } },
  },
} as const;

type MemberRow = { role: string; user: { id: string; name: string | null; email: string; isActive: boolean } };

export function serializeMember(m: MemberRow) {
  return { user_id: m.user.id, name: m.user.name, email: m.user.email, active: m.user.isActive, role: m.role };
}

export function serializeGroupDetail(g: {
  id: string;
  name: string;
  description: string | null;
  type: string;
  email: string | null;
  members: MemberRow[];
}) {
  return { id: g.id, name: g.name, description: g.description, type: g.type, email: g.email, members: g.members.map(serializeMember) };
}

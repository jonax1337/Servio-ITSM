/**
 * The membership planner of the directory -> Servio group sync. Pure and DB-free, so the rules are
 * unit-testable; lib/connectors/group-sync.ts feeds it from the directory and the database and
 * applies the result.
 *
 * Precedence, in one place:
 * - The directory wins for the users the source imported (`owned`): such a user is a member of a mapped
 *   Servio group exactly when the directory group contains them. A membership that was added by hand for
 *   a user the source owns is removed on the next run when the directory group does not have them.
 * - Everybody else is never touched: local accounts, users of another source, service accounts. Members
 *   added by hand who are not directory-sourced stay.
 * - A role (MEMBER / LEAD) is never changed: new memberships are MEMBER, an existing one keeps its role.
 * - Removals are held back for a Servio group while any directory group mapped to it could not be read
 *   reliably (`complete` false), so a lookup problem can never empty a group. Adds still happen.
 * - Several directory groups may map to one Servio group; the membership is their union.
 */

export type DirectoryMapping = {
  /** The Servio group the directory group is mapped to. */
  groupId: string;
  /** The directory group as configured (for messages). */
  label: string;
  /**
   * The directory users that are in the group. Each user is the list of external ids the directory
   * knows them by: the current form first, then the forms earlier releases stored (see ImportUser.legacyExternalIds).
   */
  members: readonly (readonly string[])[];
  /** False when the directory group could not be resolved or read, or its answer is not trustworthy. */
  complete: boolean;
};

/** A user the source imported (carries its externalId). */
export type OwnedUser = { id: string; externalId: string; email: string; name: string | null };

export type PlannedUser = { userId: string; email: string; name: string | null };

export type GroupPlan = {
  groupId: string;
  directoryGroups: string[];
  adds: PlannedUser[];
  removes: PlannedUser[];
  /** Removals that would apply but are held back because a mapped directory group was not read reliably. */
  heldBack: number;
  /** Directory members the source has not imported (yet): they join once they exist. */
  pendingNew: number;
};

export function planGroupMembership(input: {
  mappings: readonly DirectoryMapping[];
  owned: readonly OwnedUser[];
  /** The current members of every mapped Servio group: group id -> user ids. */
  current: ReadonlyMap<string, ReadonlySet<string>>;
}): GroupPlan[] {
  const byGroup = new Map<string, DirectoryMapping[]>();
  for (const m of input.mappings) byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m]);

  const ownedExternalIds = new Set(input.owned.map((u) => u.externalId));
  const plans: GroupPlan[] = [];
  for (const [groupId, mappings] of byGroup) {
    const wanted = new Set<string>();
    const directoryUsers = new Map<string, readonly string[]>();
    for (const m of mappings) {
      for (const forms of m.members) {
        if (forms.length === 0) continue;
        directoryUsers.set(forms[0], forms);
        for (const id of forms) wanted.add(id);
      }
    }
    const removalsAllowed = mappings.every((m) => m.complete);
    const members = input.current.get(groupId) ?? new Set<string>();

    const adds: PlannedUser[] = [];
    const removes: PlannedUser[] = [];
    let heldBack = 0;
    for (const u of input.owned) {
      const shouldBe = wanted.has(u.externalId);
      const is = members.has(u.id);
      const who = { userId: u.id, email: u.email, name: u.name };
      if (shouldBe && !is) adds.push(who);
      else if (!shouldBe && is) {
        if (removalsAllowed) removes.push(who);
        else heldBack++;
      }
    }
    // Directory members that are not imported users yet (a user counts once, whatever forms of the id are listed).
    const pendingNew = [...directoryUsers.values()].filter((forms) => !forms.some((id) => ownedExternalIds.has(id))).length;
    plans.push({
      groupId,
      directoryGroups: mappings.map((m) => m.label),
      adds: byEmail(adds),
      removes: byEmail(removes),
      heldBack,
      pendingNew,
    });
  }
  return plans;
}

const byEmail = (users: PlannedUser[]) => [...users].sort((a, b) => a.email.localeCompare(b.email));

export function planTotals(plans: readonly GroupPlan[]): { added: number; removed: number; heldBack: number } {
  return plans.reduce(
    (t, p) => ({ added: t.added + p.adds.length, removed: t.removed + p.removes.length, heldBack: t.heldBack + p.heldBack }),
    { added: 0, removed: 0, heldBack: 0 },
  );
}

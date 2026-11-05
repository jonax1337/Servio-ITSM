import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateTicketField: vi.fn(),
  setTicketResolution: vi.fn(),
  setTicketParent: vi.fn(),
  mergeTicket: vi.fn(),
  unmergeTicket: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { ticket: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/actions/tickets", () => ({
  updateTicketField: mocks.updateTicketField,
  setTicketResolution: mocks.setTicketResolution,
  setTicketParent: mocks.setTicketParent,
  mergeTicket: mocks.mergeTicket,
  unmergeTicket: mocks.unmergeTicket,
  addTicketComment: vi.fn(),
  escalateTicket: vi.fn(),
  linkTicket: vi.fn(),
  unlinkTicket: vi.fn(),
  addTask: vi.fn(),
  addWorkLog: vi.fn(),
  toggleWatch: vi.fn(),
  toggleMajorIncident: vi.fn(),
}));
vi.mock("@/lib/ticket-core", () => ({ createTicketCore: vi.fn() }));
vi.mock("@/lib/portal-tickets", () => ({ linkStagedAttachments: vi.fn() }));
vi.mock("@/lib/ai-tools", () => ({
  resolveGroupId: vi.fn(),
  resolveCategoryId: vi.fn(),
  resolveAgentId: vi.fn(),
  parseTicketId: (ref: string) => Number(/(\d+)/.exec(ref)?.[1]) || null,
  categoryNotFoundHint: vi.fn(),
  groupNotFoundHint: vi.fn(),
}));

import { OPERATIONS } from "@/lib/ai-operations/modules/tickets";

const ctx = { userId: "u1", role: "AGENT", name: "Agent" } as const;
const run = (id: string, args: Record<string, unknown>) => {
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`no op ${id}`);
  return op.run(args, ctx);
};

const ticket = (id: number, over: Record<string, unknown> = {}) => ({ id, type: "INCIDENT", prefix: "INC", ...over });

/** Answers every ticket lookup by id, whatever select the op asked for. */
const ticketsById = (rows: Record<number, Record<string, unknown>>) =>
  mocks.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => rows[where.id] ?? null);

/** What `redirect()` throws after a successful merge. */
const redirect = () => Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/tickets/42;307;" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ticket.set_parent", () => {
  it("passes 'none' to the action to detach and reports the detach once the parent is gone", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(ticket(43)) // resolveTicket
      .mockResolvedValueOnce({ parentId: 42 }) // current parent
      .mockResolvedValueOnce({ parentId: null }); // read back
    mocks.setTicketParent.mockResolvedValue({ ok: true });

    const res = await run("ticket.set_parent", { ref: "INC-0043", target: "none" });

    const sent = mocks.setTicketParent.mock.calls[0][0] as FormData;
    expect(sent.get("ticketId")).toBe("43");
    expect(sent.get("parentId")).toBe("none");
    expect(res).toMatchObject({ ok: true, summary: "Detached INC-0043 from its parent" });
  });

  it("returns the reason the action gave when the parent link is refused", async () => {
    ticketsById({ 43: ticket(43, { parentId: null }), 42: ticket(42) });
    mocks.setTicketParent.mockResolvedValue({ ok: false, error: "A merged ticket cannot be a parent." });

    const res = await run("ticket.set_parent", { ref: "INC-0043", target: "INC-0042" });

    expect(res).toEqual({ ok: false, error: "A merged ticket cannot be a parent." });
  });

  it("does not claim a change when the ticket already has that parent", async () => {
    ticketsById({ 43: ticket(43, { parentId: 42 }), 42: ticket(42) });

    const res = await run("ticket.set_parent", { ref: "INC-0043", target: "INC-0042" });

    expect(res).toMatchObject({ ok: true, summary: "INC-0043 is already a child of INC-0042" });
    expect(mocks.setTicketParent).not.toHaveBeenCalled();
  });

  it("does not claim a detach when the ticket has no parent", async () => {
    ticketsById({ 43: ticket(43, { parentId: null }) });

    const res = await run("ticket.set_parent", { ref: "INC-0043", target: "none" });

    expect(res).toMatchObject({ ok: true, summary: "INC-0043 has no parent to detach from" });
    expect(mocks.setTicketParent).not.toHaveBeenCalled();
  });

  it("reports an error when the parent ticket does not exist", async () => {
    ticketsById({ 43: ticket(43) });

    const res = await run("ticket.set_parent", { ref: "INC-0043", target: "INC-0099" });

    expect(res).toEqual({ ok: false, error: "Parent ticket not found: INC-0099" });
  });
});

describe("ticket.merge", () => {
  it("treats the redirect the action throws on success as a success once the stored merge matches", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(ticket(43)) // source
      .mockResolvedValueOnce(ticket(42)) // target
      .mockResolvedValueOnce({ mergedIntoId: 42 }); // read back
    mocks.mergeTicket.mockRejectedValue(redirect());

    const res = await run("ticket.merge", { ref: "INC-0043", target: "INC-0042" });

    expect(res).toMatchObject({ ok: true, summary: "Merged INC-0043 into INC-0042" });
  });

  it("rethrows an error that is not a redirect", async () => {
    ticketsById({ 43: ticket(43), 42: ticket(42) });
    mocks.mergeTicket.mockRejectedValue(new Error("database is locked"));

    await expect(run("ticket.merge", { ref: "INC-0043", target: "INC-0042" })).rejects.toThrow("database is locked");
  });

  it("returns the refusal reason without reading anything back", async () => {
    ticketsById({ 43: ticket(43), 42: ticket(42) });
    mocks.mergeTicket.mockResolvedValue({ ok: false, error: "A merged ticket cannot be merged again." });

    const res = await run("ticket.merge", { ref: "INC-0043", target: "INC-0042" });

    expect(res).toEqual({ ok: false, error: "A merged ticket cannot be merged again." });
    expect(mocks.findUnique).toHaveBeenCalledTimes(2);
  });

  it("reports an error when the redirect came but no merge is stored", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(ticket(43))
      .mockResolvedValueOnce(ticket(42))
      .mockResolvedValueOnce({ mergedIntoId: null });
    mocks.mergeTicket.mockRejectedValue(redirect());

    const res = await run("ticket.merge", { ref: "INC-0043", target: "INC-0042" });

    expect(res).toMatchObject({ ok: false });
  });
});

describe("ticket.unmerge", () => {
  it("returns the refusal reason of the action", async () => {
    ticketsById({ 43: ticket(43) });
    mocks.unmergeTicket.mockResolvedValue({ ok: false, error: "This merge can no longer be undone." });

    expect(await run("ticket.unmerge", { ref: "INC-0043" })).toEqual({
      ok: false,
      error: "This merge can no longer be undone.",
    });
  });

  it("names the restored ticket on success", async () => {
    ticketsById({ 43: ticket(43) });
    mocks.unmergeTicket.mockResolvedValue({ ok: true });

    expect(await run("ticket.unmerge", { ref: "INC-0043" })).toMatchObject({
      ok: true,
      summary: "Undid the merge of INC-0043",
    });
  });
});

describe("refusals reach the model (the merged-ticket status guard)", () => {
  const mergedRefusal = "This ticket is merged. Undo the merge instead of changing its status.";

  it("ticket.update_field returns the action's reason instead of the generic refusal", async () => {
    ticketsById({ 43: ticket(43) });
    mocks.updateTicketField.mockResolvedValue({ ok: false, error: mergedRefusal });

    const res = await run("ticket.update_field", { ref: "INC-0043", field: "status", value: "OPEN" });

    expect(res).toEqual({ ok: false, error: mergedRefusal });
  });

  it("ticket.resolve returns the reason even when the stored status already matches", async () => {
    ticketsById({ 43: ticket(43, { status: "CANCELLED" }) });
    mocks.setTicketResolution.mockResolvedValue({ ok: false, error: mergedRefusal });

    const res = await run("ticket.resolve", { ref: "INC-0043", status: "CANCELLED" });

    expect(res).toEqual({ ok: false, error: mergedRefusal });
  });

  it("ticket.update_field still verifies the stored value after a successful call", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(ticket(43))
      .mockResolvedValueOnce({ id: 43, status: "OPEN" });
    mocks.updateTicketField.mockResolvedValue({ ok: true });

    const res = await run("ticket.update_field", { ref: "INC-0043", field: "status", value: "RESOLVED" });

    expect(res).toMatchObject({ ok: false });
  });
});

import { describe, expect, it } from "vitest";
import { camelizeBody } from "@/lib/api-case";

describe("camelizeBody", () => {
  it("translates snake_case keys and keeps camelCase ones", () => {
    expect(camelizeBody({ assignee_id: "u1", requesterId: "u2", ip_address: "10.0.0.1", title: "x" })).toEqual({
      body: { requesterId: "u2", title: "x", assigneeId: "u1", ipAddress: "10.0.0.1" },
    });
  });

  it("accepts both spellings when they agree, including null", () => {
    expect(camelizeBody({ assignee_id: null, assigneeId: null })).toEqual({ body: { assigneeId: null } });
  });

  it("refuses both spellings with different values", () => {
    expect(camelizeBody({ assignee_id: "a", assigneeId: "b" })).toEqual({ conflict: ["assignee_id / assigneeId"] });
  });

  it("passes non-objects through for the schema to reject", () => {
    expect(camelizeBody([1])).toEqual({ body: [1] });
    expect(camelizeBody("x")).toEqual({ body: "x" });
  });
});

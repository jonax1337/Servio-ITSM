import { describe, expect, it } from "vitest";
import { pinnedLookup } from "@/lib/safe-fetch";

const V4 = { address: "93.184.216.34", family: 4 };
const V6 = { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 };

type Answer = { error: Error | null; address: unknown; family: unknown };

/** Runs the lookup and returns what it called back with, in either callback shape. */
function ask(addresses: { address: string; family: number }[], options: Record<string, unknown>): Answer {
  let answer: Answer | undefined;
  pinnedLookup(addresses)("example.test", options as never, ((error: Error | null, address: unknown, family: unknown) => {
    answer = { error, address, family };
  }) as never);
  if (!answer) throw new Error("lookup did not call back synchronously");
  return answer;
}

describe("pinnedLookup", () => {
  it("answers with a single address when one is asked for", () => {
    expect(ask([V6, V4], {})).toEqual({ error: null, address: V6.address, family: 6 });
  });

  it("answers with every validated address when all is set, so connect can fall back from IPv6 to IPv4", () => {
    expect(ask([V6, V4], { all: true })).toEqual({
      error: null,
      address: [
        { address: V6.address, family: 6 },
        { address: V4.address, family: 4 },
      ],
      family: undefined,
    });
  });

  it("honours a requested family, as number or name", () => {
    expect(ask([V6, V4], { family: 4 }).address).toBe(V4.address);
    expect(ask([V6, V4], { family: "IPv6" }).address).toBe(V6.address);
    expect(ask([V6, V4], { family: 4, all: true }).address).toEqual([{ address: V4.address, family: 4 }]);
    expect(ask([V6, V4], { family: 0 }).address).toBe(V6.address);
  });

  it("fails when no validated address has the requested family", () => {
    expect(ask([V4], { family: 6 }).error).toBeInstanceOf(Error);
  });

  it("still rejects private and reserved addresses, in both callback shapes", () => {
    const privateOnly = [{ address: "10.0.0.5", family: 4 }];
    expect(ask(privateOnly, {}).error?.message).toMatch(/private\/reserved/);
    expect(ask(privateOnly, { all: true }).error?.message).toMatch(/private\/reserved/);
    expect(ask([{ address: "169.254.169.254", family: 4 }], {}).error).toBeInstanceOf(Error);
  });

  it("drops a private address from a mixed set instead of handing it out", () => {
    const mixed = [{ address: "127.0.0.1", family: 4 }, V4];
    expect(ask(mixed, { all: true }).address).toEqual([{ address: V4.address, family: 4 }]);
  });

  it("fails on an empty set", () => {
    expect(ask([], {}).error).toBeInstanceOf(Error);
  });
});

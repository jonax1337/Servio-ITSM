import { describe, expect, it } from "vitest";
import { readActionResult } from "@/lib/action-result";

describe("readActionResult", () => {
  it("reads a success result", () => {
    expect(readActionResult({ ok: true })).toEqual({ ok: true });
  });

  it("reads a refusal with its message", () => {
    expect(readActionResult({ ok: false, error: "Nope" })).toEqual({ ok: false, error: "Nope" });
  });

  it("ignores a non-string error", () => {
    expect(readActionResult({ ok: false, error: 42 })).toEqual({ ok: false });
  });

  it("returns null for actions that return nothing or something else", () => {
    expect(readActionResult(undefined)).toBeNull();
    expect(readActionResult(null)).toBeNull();
    expect(readActionResult("done")).toBeNull();
    expect(readActionResult({ ok: "yes" })).toBeNull();
    expect(readActionResult({ id: 1 })).toBeNull();
  });
});

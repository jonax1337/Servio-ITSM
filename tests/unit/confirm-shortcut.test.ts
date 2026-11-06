import { describe, expect, it } from "vitest";
import { isConfirmShortcut } from "@/lib/confirm-shortcut";

const key = (overrides: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...overrides,
});
const plain = { inEditor: false, onControl: false };

describe("isConfirmShortcut", () => {
  it("confirms on Enter away from the editor and from controls", () => {
    expect(isConfirmShortcut(key(), plain)).toBe(true);
  });

  it("ignores other keys", () => {
    expect(isConfirmShortcut(key({ key: "a" }), plain)).toBe(false);
  });

  it("leaves Enter in the note editor to start a new paragraph", () => {
    expect(isConfirmShortcut(key(), { inEditor: true, onControl: false })).toBe(false);
  });

  it("leaves Enter on a control to activate it", () => {
    expect(isConfirmShortcut(key(), { inEditor: false, onControl: true })).toBe(false);
  });

  it.each([["ctrlKey"], ["metaKey"]] as const)("confirms on %s+Enter even inside the editor", (modifier) => {
    expect(isConfirmShortcut(key({ [modifier]: true }), { inEditor: true, onControl: false })).toBe(true);
  });

  it("does not confirm on Shift+Enter", () => {
    expect(isConfirmShortcut(key({ shiftKey: true }), plain)).toBe(false);
  });
});

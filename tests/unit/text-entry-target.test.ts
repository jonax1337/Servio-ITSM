import { describe, expect, it } from "vitest";
import { isTextEntryTarget } from "@/lib/utils";

// Global single-key shortcuts (e.g. "/" for the command palette) must not fire
// while the user is typing — including inside rich-text (contenteditable) editors.
describe("isTextEntryTarget", () => {
  it("treats inputs, textareas and selects as text entry", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTextEntryTarget({ tagName, isContentEditable: false } as unknown as EventTarget), tagName).toBe(true);
    }
  });

  it("treats contenteditable rich-text editors as text entry", () => {
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it("lets shortcuts through on plain page elements and without a target", () => {
    expect(isTextEntryTarget({ tagName: "BODY", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

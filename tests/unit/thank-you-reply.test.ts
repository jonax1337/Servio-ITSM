import { describe, expect, it } from "vitest";
import { isThankYouOnly } from "@/lib/thank-you-reply";

describe("isThankYouOnly", () => {
  it.each([
    "Danke, läuft wieder! :)\n\nMehmet",
    "Vielen Dank für die schnelle Hilfe!",
    "Thanks, works now.",
    "Thank you so much!",
    "Super, merci!",
  ])("treats a short courtesy reply as thanks: %s", (text) => {
    expect(isThankYouOnly(text)).toBe(true);
  });

  it.each([
    "Danke, aber es geht immer noch nicht.",
    "Danke! Leider kommt der Fehler wieder.",
    "Thanks, but it still crashes.",
    "Danke – können Sie auch den Drucker im 1. OG prüfen?",
    "Thanks, the issue is back again",
    "Hallo, das Problem ist zurück.",
    "",
  ])("treats anything that could be a new problem as a real reply: %s", (text) => {
    expect(isThankYouOnly(text)).toBe(false);
  });

  it("treats a long message as a real reply even when it starts with thanks", () => {
    expect(isThankYouOnly(`Danke! ${"Noch eine längere Beschreibung. ".repeat(10)}`)).toBe(false);
  });
});

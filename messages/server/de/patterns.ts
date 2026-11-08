import type { ServerMessagePattern } from "../../types";

/**
 * Pattern rules for server messages with variable parts, tried in order after the exact-text
 * catalog. Covers Zod's default (English) validation messages, which reach the UI as
 * `fieldErrors`, plus generic shapes. `$1`… refer to the capture groups.
 */
export const patterns: ServerMessagePattern[] = [
  // Zod 4 defaults
  [/^Too small: expected string to have >=1 characters$/, "Dieses Feld ist erforderlich."],
  [/^Too small: expected string to have >=(\d+) characters$/, "Mindestens $1 Zeichen erforderlich."],
  [/^Too small: expected string to have >(\d+) characters$/, "Mehr als $1 Zeichen erforderlich."],
  [/^Too big: expected string to have <=(\d+) characters$/, "Höchstens $1 Zeichen erlaubt."],
  [/^Too big: expected string to have <(\d+) characters$/, "Weniger als $1 Zeichen erlaubt."],
  [/^Too small: expected array to have >=(\d+) items$/, "Mindestens $1 Einträge erforderlich."],
  [/^Too big: expected array to have <=(\d+) items$/, "Höchstens $1 Einträge erlaubt."],
  [/^Too small: expected number to be >=(-?[\d.]+)$/, "Der Wert muss mindestens $1 sein."],
  [/^Too small: expected number to be >(-?[\d.]+)$/, "Der Wert muss größer als $1 sein."],
  [/^Too big: expected number to be <=(-?[\d.]+)$/, "Der Wert darf höchstens $1 sein."],
  [/^Too big: expected number to be <(-?[\d.]+)$/, "Der Wert muss kleiner als $1 sein."],
  [/^Invalid input: expected string, received (undefined|null)$/, "Dieses Feld ist erforderlich."],
  [/^Invalid input: expected number, received NaN$/, "Bitte eine Zahl eingeben."],
  [/^Invalid input: expected (\w+), received (\w+)$/, "Ungültige Eingabe."],
  [/^Invalid option: expected one of .*$/, "Ungültige Auswahl."],
  [/^Invalid input: expected .*$/, "Ungültige Eingabe."],
  [/^Invalid email address$/, "Ungültige E-Mail-Adresse."],
  [/^Invalid URL$/, "Ungültige URL."],
  [/^Invalid ISO datetime$/, "Ungültiges Datum mit Uhrzeit."],
  [/^Invalid ISO date$/, "Ungültiges Datum."],
  [/^Invalid string: must match pattern .*$/, "Ungültiges Format."],
  [/^Invalid number: must be a multiple of (.+)$/, "Der Wert muss ein Vielfaches von $1 sein."],
  [/^Invalid input$/, "Ungültige Eingabe."],
];

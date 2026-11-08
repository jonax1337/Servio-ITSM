import type { ServerMessagePattern } from "../../types";

/**
 * Pattern rules for server messages with variable parts, tried in order after the exact-text
 * catalog. Covers Zod's default (English) validation messages, which reach the UI as
 * `fieldErrors`, plus generic shapes. `$1`… refer to the capture groups.
 */
export const patterns: ServerMessagePattern[] = [
  // Module messages with numbers or names in them
  [/^Ticket hierarchies can be at most (\d+) levels deep\.$/, "Ticket-Hierarchien dürfen höchstens $1 Ebenen tief sein."],
  [/^Ticket (\d+) does not exist\.$/, "Ticket $1 existiert nicht."],
  [/^Ticket (\d+) is not a major incident\.$/, "Ticket $1 ist kein Major Incident."],
  [/^In use by 1 record — archive it instead of deleting\.$/, "Wird von 1 Datensatz verwendet — bitte archivieren statt löschen."],
  [/^In use by (\d+) records — archive it instead of deleting\.$/, "Wird von $1 Datensätzen verwendet — bitte archivieren statt löschen."],
  [/^An article can't move from (\w+) to (\w+)\.$/, "Ein Artikel kann nicht von $1 nach $2 wechseln."],
  [/^Version (\S+) is not newer than the installed version (\S+)\.$/, "Version $1 ist nicht neuer als die installierte Version $2."],
  [/^The window overlaps "(.*)"\. Maintenance windows cannot overlap\.$/, "Das Wartungsfenster überschneidet sich mit „$1“. Wartungsfenster dürfen sich nicht überschneiden."],
  [/^Stage (\d+): the selected group no longer exists\.$/, "Stufe $1: Die gewählte Gruppe existiert nicht mehr."],
  [/^Stage (\d+): the selected group has no active agents to approve\.$/, "Stufe $1: Die gewählte Gruppe hat keine aktiven Agents zum Genehmigen."],
  [/^Stage (\d+): the selected approver is not an active agent\.$/, "Stufe $1: Die gewählte genehmigende Person ist kein aktiver Agent."],
  [/^Stage (\d+): choose an approver or a group\.$/, "Stufe $1: Bitte eine genehmigende Person oder Gruppe wählen."],
  [/^Action (\d+): choose an action\.$/, "Aktion $1: Bitte eine Aktion wählen."],
  [/^Condition (\d+): (.+)$/, "Bedingung $1: $2"],
  [/^Action (\d+) \((.+)\): (.+)$/, "Aktion $1 ($2): $3"],
  [/^The (.+) list could not be read\.$/, "Die Liste „$1“ konnte nicht gelesen werden."],
  [/^The MCP server "(.*)" is no longer available\.$/, "Der MCP-Server „$1“ ist nicht mehr verfügbar."],
  [/^The MCP server "(.*)" is read-only, so this call can't run\.$/, "Der MCP-Server „$1“ ist schreibgeschützt; dieser Aufruf kann nicht ausgeführt werden."],
  [/^The MCP server "(.*)" is misconfigured: (.+)$/, "Der MCP-Server „$1“ ist falsch konfiguriert: $2"],
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

import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Problems, assets, contracts/licenses/vendors, locations, categories.
const messages: ServerMessages = {
  // Shared
  "Invalid": "Ungültig",
  "Invalid request.": "Ungültige Anfrage.",
  "Please check the form.": "Bitte prüfen Sie das Formular.",
  "Saved (no changes)": "Gespeichert (keine Änderungen)",
  "Name must be at least 2 characters": "Der Name muss mindestens 2 Zeichen lang sein",
  "Title must be at least 3 characters": "Der Titel muss mindestens 3 Zeichen lang sein",
  "Title must be at least 3 characters.": "Der Titel muss mindestens 3 Zeichen lang sein.",
  "You are not signed in as an agent.": "Sie sind nicht als Agent angemeldet.",
  "User not found.": "Benutzer nicht gefunden.",
  "Owner not found.": "Verantwortliche Person nicht gefunden.",
  "Ticket not found.": "Ticket nicht gefunden.",
  "Change not found.": "Change nicht gefunden.",
  "Missing link.": "Verknüpfung fehlt.",
  "You can't change this ticket — it belongs to a group you're not a member of.":
    "Sie können dieses Ticket nicht ändern – es gehört zu einer Gruppe, in der Sie nicht Mitglied sind.",
  // Problems
  "Problem not found.": "Problem nicht gefunden.",
  "Choose a ticket.": "Wählen Sie ein Ticket aus.",
  "Choose at least one ticket": "Wählen Sie mindestens ein Ticket aus",
  "Choose a change.": "Wählen Sie einen Change aus.",
  "That change isn't valid for this problem.": "Dieser Change ist für dieses Problem nicht zulässig.",
  "That status change isn't allowed from the current status.":
    "Dieser Statuswechsel ist vom aktuellen Status aus nicht erlaubt.",
  "The assignee must be a member of the problem's group.":
    "Der Bearbeiter muss Mitglied der Gruppe des Problems sein.",
  "This problem was changed by someone else. Reload and try again.":
    "Dieses Problem wurde zwischenzeitlich geändert. Laden Sie die Seite neu und versuchen Sie es erneut.",
  "A known error needs a documented workaround.": "Ein bekannter Fehler braucht einen dokumentierten Workaround.",
  "A resolved problem needs a documented root cause.": "Ein gelöstes Problem braucht eine dokumentierte Ursache.",
  "This problem is closed. Reopen it to edit this field.":
    "Dieses Problem ist geschlossen. Öffnen Sie es erneut, um dieses Feld zu bearbeiten.",
  "None of these tickets can be linked: they already belong to a problem, or are outside your groups.":
    "Keines dieser Tickets kann verknüpft werden: Sie gehören bereits zu einem Problem oder liegen außerhalb Ihrer Gruppen.",
  // Assets
  "Asset not found.": "Asset nicht gefunden.",
  "This asset tag is already in use.": "Diese Asset-Kennung wird bereits verwendet.",
  "Choose a different asset.": "Wählen Sie ein anderes Asset aus.",
  "Unknown relationship type.": "Unbekannter Beziehungstyp.",
  "Missing relationship.": "Beziehung fehlt.",
  "Retired or disposed assets can't be added to a change.":
    "Außer Betrieb genommene oder entsorgte Assets können keinem Change hinzugefügt werden.",
  // Contracts, licenses, vendors
  "Only managers can change vendors, contracts and licenses.":
    "Nur Manager können Hersteller, Verträge und Lizenzen ändern.",
  "Contract not found.": "Vertrag nicht gefunden.",
  "License not found.": "Lizenz nicht gefunden.",
  "Vendor not found.": "Hersteller nicht gefunden.",
  "A vendor with that name already exists.": "Ein Hersteller mit diesem Namen existiert bereits.",
  "Choose a contract and an asset.": "Wählen Sie einen Vertrag und ein Asset aus.",
  "The end date can't be before the start date.": "Das Enddatum darf nicht vor dem Startdatum liegen.",
  "Choose a user, an asset, or both.": "Wählen Sie einen Benutzer, ein Asset oder beides.",
  "That seat is already assigned.": "Diese Lizenz ist bereits zugewiesen.",
  "Enter a valid email address": "Geben Sie eine gültige E-Mail-Adresse ein",
  "Choose a contract type": "Wählen Sie einen Vertragstyp",
  "Choose a contract status": "Wählen Sie einen Vertragsstatus",
  "Choose a license type": "Wählen Sie einen Lizenztyp",
  "Cost must be a number": "Die Kosten müssen eine Zahl sein",
  "Cost can't be negative": "Die Kosten dürfen nicht negativ sein",
  "Start date is required": "Startdatum ist erforderlich",
  "Start date is not a valid date": "Das Startdatum ist kein gültiges Datum",
  "End date is not a valid date": "Das Enddatum ist kein gültiges Datum",
  "Expiry date is not a valid date": "Das Ablaufdatum ist kein gültiges Datum",
  "Renewal notice must be a number": "Die Kündigungsfrist muss eine Zahl sein",
  "Renewal notice must be a whole number": "Die Kündigungsfrist muss eine ganze Zahl sein",
  "Renewal notice must be at least 0": "Die Kündigungsfrist muss mindestens 0 sein",
  "Renewal notice must be at most 3650": "Die Kündigungsfrist darf höchstens 3650 sein",
  "Seats must be a number": "Die Anzahl der Lizenzen muss eine Zahl sein",
  "Seats must be a whole number": "Die Anzahl der Lizenzen muss eine ganze Zahl sein",
  "Seats must be at least 1": "Die Anzahl der Lizenzen muss mindestens 1 sein",
  "Seats must be at most 1000000": "Die Anzahl der Lizenzen darf höchstens 1000000 sein",
  // Locations
  "Location not found.": "Standort nicht gefunden.",
  "This location no longer exists.": "Dieser Standort existiert nicht mehr.",
  "A location can't be moved under itself or one of its children.":
    "Ein Standort kann nicht unter sich selbst oder einen seiner Unterstandorte verschoben werden.",
  // Categories
  "Move or remove its subcategories first.": "Verschieben oder entfernen Sie zuerst die Unterkategorien.",
  "Use a hex color like #64748b": "Verwenden Sie eine Hex-Farbe wie #64748b",
};

export default messages;

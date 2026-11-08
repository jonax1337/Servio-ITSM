import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Tickets: lib/actions/tickets.ts, attachments, article links, macro runs, the upload route and
// the ticket rule helpers (refusals, merge, hierarchy) whose messages the ticket UI shows.
const messages: ServerMessages = {
  // lib/actions/tickets.ts
  "Missing ticket.": "Ticket fehlt.",
  "Ticket not found.": "Ticket nicht gefunden.",
  "Ticket not found": "Ticket nicht gefunden",
  "You can't act on this ticket.": "Sie können dieses Ticket nicht bearbeiten.",
  "Priority is already Critical": "Die Priorität ist bereits Kritisch",
  "Missing link.": "Verknüpfung fehlt.",
  "Link not found.": "Verknüpfung nicht gefunden.",
  "You can't act on either linked ticket.": "Sie können keines der verknüpften Tickets bearbeiten.",
  "Enter a valid number of minutes.": "Bitte eine gültige Anzahl Minuten eingeben.",
  "Missing data.": "Daten fehlen.",
  "Please enter a valid email address.": "Bitte eine gültige E-Mail-Adresse eingeben.",
  "Message not found.": "Nachricht nicht gefunden.",
  "Use a public reply to contact the requester.": "Für den Kontakt mit dem Anfragenden bitte eine öffentliche Antwort verwenden.",
  "Asset not found.": "Asset nicht gefunden.",
  "Change not found.": "Change nicht gefunden.",
  "Problem not found.": "Problem nicht gefunden.",
  "Could not create the ticket.": "Das Ticket konnte nicht angelegt werden.",
  "Pick another ticket to merge into.": "Bitte ein anderes Ticket zum Zusammenführen wählen.",
  "That change isn't valid for this ticket.": "Dieser Change ist für dieses Ticket nicht gültig.",
  "That link request isn't valid.": "Diese Verknüpfungsanfrage ist ungültig.",
  "These tickets are already linked.": "Diese Tickets sind bereits verknüpft.",
  "This field changed since — not undone.": "Dieses Feld wurde inzwischen geändert – nicht rückgängig gemacht.",
  "You are not signed in as an agent.": "Sie sind nicht als Agent angemeldet.",
  "Could not save changes.": "Änderungen konnten nicht gespeichert werden.",
  "Could not update watch.": "Beobachten konnte nicht aktualisiert werden.",
  "Requester is required": "Anfragender ist erforderlich",
  "Title must be at least 3 characters": "Der Titel muss mindestens 3 Zeichen lang sein",
  // lib/ticket-refusals.ts, lib/merge-rules.ts, lib/ticket-hierarchy-rules.ts
  "That agent isn't a member of the ticket's group.": "Dieser Agent ist kein Mitglied der Gruppe des Tickets.",
  "The status workflow doesn't allow this change.": "Der Status-Workflow erlaubt diese Änderung nicht.",
  "This request is awaiting approval; it can only be cancelled until it is decided.":
    "Diese Anfrage wartet auf Genehmigung; bis zur Entscheidung kann sie nur storniert werden.",
  "You can't change this ticket — it belongs to a group you're not a member of.":
    "Sie können dieses Ticket nicht ändern – es gehört zu einer Gruppe, in der Sie kein Mitglied sind.",
  "You can't link articles to this ticket — it belongs to a group you're not a member of.":
    "Sie können diesem Ticket keine Artikel zuordnen – es gehört zu einer Gruppe, in der Sie kein Mitglied sind.",
  "The target is a child of this ticket. Detach it first or pick another ticket.":
    "Das Ziel ist diesem Ticket untergeordnet. Lösen Sie es zuerst oder wählen Sie ein anderes Ticket.",
  "The ticket it was merged into has itself been merged since. Undo that merge first.":
    "Das Ziel-Ticket wurde inzwischen selbst zusammengeführt. Machen Sie zuerst diese Zusammenführung rückgängig.",
  "There is no merge to undo for this ticket. Merges made before undo existed can't be reverted.":
    "Für dieses Ticket gibt es keine Zusammenführung zum Rückgängigmachen. Ältere Zusammenführungen lassen sich nicht zurücknehmen.",
  "This merge has already been undone.": "Diese Zusammenführung wurde bereits rückgängig gemacht.",
  "This ticket is already merged into another ticket.": "Dieses Ticket ist bereits mit einem anderen Ticket zusammengeführt.",
  "This ticket is no longer merged into the ticket recorded for the merge.":
    "Dieses Ticket ist nicht mehr mit dem bei der Zusammenführung erfassten Ticket zusammengeführt.",
  "This ticket was changed or merged by someone else in the meantime. Reload and try again.":
    "Dieses Ticket wurde inzwischen von jemand anderem geändert oder zusammengeführt. Bitte neu laden und erneut versuchen.",
  "This ticket was merged into another ticket. Undo the merge instead of changing its status.":
    "Dieses Ticket wurde mit einem anderen zusammengeführt. Machen Sie die Zusammenführung rückgängig, statt den Status zu ändern.",
  "You can't merge into a cancelled or merged ticket.": "Mit einem stornierten oder zusammengeführten Ticket kann nicht zusammengeführt werden.",
  "That would make the ticket its own ancestor.": "Damit wäre das Ticket sich selbst übergeordnet.",
  // lib/actions/article-links.ts
  "Article not found.": "Artikel nicht gefunden.",
  "Choose an article.": "Bitte einen Artikel auswählen.",
  "Only published articles, or your own drafts, can be linked.":
    "Nur veröffentlichte Artikel oder eigene Entwürfe können verknüpft werden.",
  // lib/actions/macros.ts (applyMacro)
  "Missing ticket or macro.": "Ticket oder Makro fehlt.",
  "That macro no longer exists.": "Dieses Makro existiert nicht mehr.",
  "This macro is malformed.": "Dieses Makro ist fehlerhaft.",
  "You can't use that macro.": "Sie können dieses Makro nicht verwenden.",
  "You need agent access to run macros.": "Zum Ausführen von Makros sind Agent-Rechte erforderlich.",
  // lib/actions/ai.ts (composer helpers)
  "Nothing to improve.": "Nichts zu verbessern.",
  // app/api/files/upload
  "Could not attach the file to the project.": "Die Datei konnte dem Projekt nicht zugeordnet werden.",
  "Could not attach the file.": "Die Datei konnte nicht angehängt werden.",
  "Could not parse the upload.": "Der Upload konnte nicht verarbeitet werden.",
  "Could not store the file.": "Die Datei konnte nicht gespeichert werden.",
  "Expected multipart/form-data.": "multipart/form-data erwartet.",
  "File is too large.": "Die Datei ist zu groß.",
  "File is too large for this server's request body limit.": "Die Datei überschreitet das Größenlimit dieses Servers für Anfragen.",
  "Invalid change id.": "Ungültige Change-ID.",
  "Invalid problem id.": "Ungültige Problem-ID.",
  "Invalid ticket id.": "Ungültige Ticket-ID.",
  "No file provided.": "Keine Datei angegeben.",
  "Not found.": "Nicht gefunden.",
  "Provide at most one target.": "Höchstens ein Ziel angeben.",
  "Sign in to upload files.": "Zum Hochladen bitte anmelden.",
  "The file is empty.": "Die Datei ist leer.",
  "This file type is not allowed.": "Dieser Dateityp ist nicht erlaubt.",
  "You're uploading too quickly. Please wait a moment and try again.":
    "Sie laden zu schnell hoch. Bitte kurz warten und erneut versuchen.",
};

export default messages;

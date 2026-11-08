import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Knowledge, services, catalog, status page, on-call, maintenance, automations, insights.
const messages: ServerMessages = {
  // Knowledge
  "Article body cannot be empty": "Der Artikelinhalt darf nicht leer sein",
  "The ticket this article is written from no longer exists.": "Das Ticket, aus dem dieser Artikel entsteht, existiert nicht mehr.",
  "You can't link articles to this ticket — it belongs to a group you're not a member of.":
    "Sie können diesem Ticket keine Artikel zuordnen — es gehört zu einer Gruppe, in der Sie nicht Mitglied sind.",
  "You need agent access to author articles.": "Zum Verfassen von Artikeln benötigen Sie Agent-Rechte.",
  "Could not save the article, please try again.": "Der Artikel konnte nicht gespeichert werden, bitte erneut versuchen.",
  "You need agent access to edit articles.": "Zum Bearbeiten von Artikeln benötigen Sie Agent-Rechte.",
  "Article not found.": "Artikel nicht gefunden.",
  "Save conflicted with a concurrent edit, please retry.": "Das Speichern kollidierte mit einer gleichzeitigen Bearbeitung, bitte erneut versuchen.",
  "You need agent access to change an article's status.": "Zum Ändern des Artikelstatus benötigen Sie Agent-Rechte.",
  "Unknown article status.": "Unbekannter Artikelstatus.",
  "Publishing an article requires manager approval.": "Das Veröffentlichen eines Artikels erfordert die Freigabe eines Managers.",
  "An article must be published by a different reviewer than its author.":
    "Ein Artikel muss von einer anderen prüfenden Person als der verfassenden veröffentlicht werden.",
  // Services
  "Name must be at least 2 characters": "Der Name muss mindestens 2 Zeichen lang sein",
  "A service with that name already exists.": "Ein Service mit diesem Namen existiert bereits.",
  "You are not signed in as an agent.": "Sie sind nicht als Agent angemeldet.",
  "Choose an asset.": "Bitte ein Asset auswählen.",
  "Service not found.": "Service nicht gefunden.",
  "Asset not found.": "Asset nicht gefunden.",
  "Missing link.": "Verknüpfung fehlt.",
  // Catalog
  "Approval is required for this item, but no approver or approval stage was configured.":
    "Für diesen Eintrag ist eine Genehmigung erforderlich, aber es wurde keine genehmigende Person und keine Genehmigungsstufe festgelegt.",
  "Item not found": "Eintrag nicht gefunden",
  // Status page
  "Status incident not found.": "Störungsmeldung nicht gefunden.",
  "You can't link a ticket you can't act on.": "Sie können kein Ticket verknüpfen, das Sie nicht bearbeiten dürfen.",
  "That ticket is already linked to another status incident.": "Dieses Ticket ist bereits mit einer anderen Störungsmeldung verknüpft.",
  "Pick a valid state.": "Bitte einen gültigen Zustand wählen.",
  "Title must be at least 3 characters.": "Der Titel muss mindestens 3 Zeichen lang sein.",
  "Write at least a few words for the update.": "Schreiben Sie wenigstens ein paar Worte für die Aktualisierung.",
  "The update is too long.": "Die Aktualisierung ist zu lang.",
  "Invalid input.": "Ungültige Eingabe.",
  "Enter the linked ticket as a number, e.g. 42.": "Geben Sie das verknüpfte Ticket als Zahl ein, z. B. 42.",
  "One of the selected services no longer exists.": "Einer der ausgewählten Services existiert nicht mehr.",
  "Invalid visibility.": "Ungültige Sichtbarkeit.",
  // On-call
  "That team no longer exists.": "Dieses Team existiert nicht mehr.",
  "Every rotation member must be an active agent.": "Jedes Mitglied der Rotation muss ein aktiver Agent sein.",
  "Schedule not found.": "Plan nicht gefunden.",
  "Choose a team": "Bitte ein Team auswählen",
  "Add at least one person to the rotation": "Fügen Sie der Rotation mindestens eine Person hinzu",
  "Enter the shift length in hours": "Geben Sie die Schichtlänge in Stunden an",
  "Choose who is on call.": "Wählen Sie, wer Rufbereitschaft hat.",
  "Enter a start.": "Bitte einen Beginn angeben.",
  "Enter an end.": "Bitte ein Ende angeben.",
  "The reason can be at most 300 characters.": "Der Grund darf höchstens 300 Zeichen lang sein.",
  // Maintenance
  "Only admins can manage maintenance windows.": "Nur Administratoren können Wartungsfenster verwalten.",
  "Title must be at least 2 characters.": "Der Titel muss mindestens 2 Zeichen lang sein.",
  "The window must last at least a minute.": "Das Fenster muss mindestens eine Minute dauern.",
  "Invalid request.": "Ungültige Anfrage.",
  "Start must be a valid date and time.": "Der Beginn muss ein gültiges Datum mit Uhrzeit sein.",
  "Only a scheduled window can be started.": "Nur ein geplantes Fenster kann gestartet werden.",
  "The window was changed in the meantime.": "Das Fenster wurde inzwischen geändert.",
  "Maintenance window not found.": "Wartungsfenster nicht gefunden.",
  "Only a scheduled window can be cancelled.": "Nur ein geplantes Fenster kann abgesagt werden.",
  "Only a running maintenance window can be ended.": "Nur ein laufendes Wartungsfenster kann beendet werden.",
  "Only a running update can be aborted.": "Nur ein laufendes Update kann abgebrochen werden.",
  "The window already ended.": "Das Fenster ist bereits beendet.",
  "The window must end after it starts.": "Das Fenster muss nach seinem Beginn enden.",
  "The window cannot start in the past.": "Das Fenster kann nicht in der Vergangenheit beginnen.",
  "A maintenance window can last at most 24 hours.": "Ein Wartungsfenster darf höchstens 24 Stunden dauern.",
  "Choose the version to update to.": "Wählen Sie die Zielversion für das Update.",
  "The updater is not connected, so an update cannot run. Start the updater service first (see the update guide).":
    "Der Updater ist nicht verbunden, daher kann kein Update laufen. Starten Sie zuerst den Updater-Dienst (siehe Update-Anleitung).",
  "Add at least one action.": "Fügen Sie mindestens eine Aktion hinzu.",
  // Automations
  "An action refers to an agent who is not active.": "Eine Aktion verweist auf einen Agent, der nicht aktiv ist.",
  "An action refers to a group that no longer exists.": "Eine Aktion verweist auf eine Gruppe, die nicht mehr existiert.",
  // Insights
  "Missing insight.": "Erkenntnis fehlt.",
};

export default messages;

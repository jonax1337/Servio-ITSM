import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Knowledge, services, catalog, status page, on-call, maintenance, backups, automations, insights,
// recurring tickets.
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
  "Managing services needs a manager or admin.": "Services zu verwalten setzt die Rolle Manager oder Admin voraus.",
  "The service is still referenced. Set its status to RETIRED instead of deleting it.":
    "Der Service wird noch referenziert. Setzen Sie den Status auf RETIRED, statt ihn zu löschen.",
  "Choose an asset.": "Bitte ein Asset auswählen.",
  "Service not found.": "Service nicht gefunden.",
  "Asset not found.": "Asset nicht gefunden.",
  "Missing link.": "Verknüpfung fehlt.",
  "A service with that code already exists.": "Ein Service mit dieser Servicenummer existiert bereits.",
  "Code must be unique": "Die Servicenummer muss eindeutig sein",
  "1-32 characters: letters, digits and . _ / -, starting with a letter or digit":
    "1–32 Zeichen: Buchstaben, Ziffern und . _ / -, beginnend mit einem Buchstaben oder einer Ziffer",
  "Choose a service.": "Bitte einen Service auswählen.",
  "A service cannot depend on itself.": "Ein Service kann nicht von sich selbst abhängen.",
  // Catalog
  "Every question needs a label": "Jede Frage braucht eine Beschriftung",
  "Question keys are 1-100 characters: letters, digits, _ or -":
    "Frageschlüssel bestehen aus 1–100 Zeichen: Buchstaben, Ziffern, _ oder -",
  "Choose at least one answer that shows the question": "Bitte mindestens eine Antwort wählen, bei der die Frage angezeigt wird",
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
  // Backups
  "Only admins can start a backup.": "Nur Administratoren können eine Sicherung starten.",
  "A backup is already running.": "Es läuft bereits eine Sicherung.",
  "The built-in backup supports SQLite databases only.": "Die eingebaute Sicherung unterstützt nur SQLite-Datenbanken.",
  "Use a time between 00:00 and 23:59.": "Bitte eine Uhrzeit zwischen 00:00 und 23:59 angeben.",
  "Enter a daily time (HH:MM) or a cron expression with five fields.":
    "Bitte eine tägliche Uhrzeit (HH:MM) oder einen Cron-Ausdruck mit fünf Feldern angeben.",
  "Backups can run at most once an hour.": "Sicherungen können höchstens einmal pro Stunde laufen.",
  "Keep between 1 and 1000 backups.": "Es müssen zwischen 1 und 1000 Sicherungen aufbewahrt werden.",
  "Unknown time zone: use an IANA name such as UTC or America/New_York.":
    "Unbekannte Zeitzone: bitte einen IANA-Namen wie UTC oder America/New_York angeben.",
  "Keep backups for 0 to 3650 days.": "Sicherungen werden 0 bis 3650 Tage aufbewahrt.",
  // Automations
  "An action refers to an agent who is not active.": "Eine Aktion verweist auf einen Agent, der nicht aktiv ist.",
  "An action refers to a group that no longer exists.": "Eine Aktion verweist auf eine Gruppe, die nicht mehr existiert.",
  // Insights
  "Missing insight.": "Erkenntnis fehlt.",
  // Recurring tickets (lib/actions/recurring-tickets.ts, lib/recurring-ticket-input.ts, lib/recurring-tickets.ts)
  "Not authorised: only managers can manage recurring tickets.": "Nicht berechtigt: Nur Manager können wiederkehrende Tickets verwalten.",
  "Recurring ticket not found.": "Wiederkehrendes Ticket nicht gefunden.",
  "The requester isn't valid: choose an active user.": "Der Anfragende ist ungültig: Bitte einen aktiven Benutzer wählen.",
  "The assignee isn't valid: choose an active agent.": "Der Bearbeiter ist ungültig: Bitte einen aktiven Agent wählen.",
  "The group isn't valid: it no longer exists.": "Die Gruppe ist ungültig: Sie existiert nicht mehr.",
  "The category isn't valid: it no longer exists.": "Die Kategorie ist ungültig: Sie existiert nicht mehr.",
  "The service isn't valid: it no longer exists.": "Der Service ist ungültig: Er existiert nicht mehr.",
  "A recurring ticket with that import reference already exists.": "Ein wiederkehrendes Ticket mit dieser Importreferenz existiert bereits.",
  "The schedule changed in the meantime. Reload and try again.": "Der Zeitplan wurde inzwischen geändert. Bitte neu laden und erneut versuchen.",
  "The schedule has no requester (its creator was deleted). Edit it and choose one.":
    "Der Zeitplan hat keinen Anfragenden (sein Ersteller wurde gelöscht). Bitte bearbeiten und einen auswählen.",
  "The ticket could not be created: The schedule has no requester (its creator was deleted). Edit it and choose one.":
    "Das Ticket konnte nicht angelegt werden: Der Zeitplan hat keinen Anfragenden (sein Ersteller wurde gelöscht). Bitte bearbeiten und einen auswählen.",
  "Name must be at most 120 characters": "Der Name darf höchstens 120 Zeichen lang sein",
  "Title must be at most 250 characters": "Der Titel darf höchstens 250 Zeichen lang sein",
  "Description is too long": "Die Beschreibung ist zu lang",
  "Choose a ticket type": "Bitte einen Tickettyp wählen",
  "Choose a priority": "Bitte eine Priorität wählen",
  "Choose an impact": "Bitte eine Auswirkung wählen",
  "Choose an urgency": "Bitte eine Dringlichkeit wählen",
  "Choose how often it recurs": "Bitte wählen, wie oft es sich wiederholt",
  "Interval must be a number": "Das Intervall muss eine Zahl sein",
  "Interval must be a whole number": "Das Intervall muss eine ganze Zahl sein",
  "Lead time must be a number": "Die Vorlaufzeit muss eine Zahl sein",
  "Lead time must be a whole number": "Die Vorlaufzeit muss eine ganze Zahl sein",
  "Unknown time zone (use an IANA name like Europe/Berlin)": "Unbekannte Zeitzone (IANA-Namen wie Europe/Berlin verwenden)",
  "Choose the first due date": "Bitte die erste Fälligkeit wählen",
  "Enter the first due date and time": "Bitte Datum und Uhrzeit der ersten Fälligkeit angeben",
  "Not a valid date and time": "Kein gültiges Datum mit Uhrzeit",
  "At most 200 characters": "Höchstens 200 Zeichen",
};

export default messages;

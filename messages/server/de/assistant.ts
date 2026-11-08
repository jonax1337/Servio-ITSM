import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
const messages: ServerMessages = {
  "Not found": "Nicht gefunden",
  "Ticket not found": "Ticket nicht gefunden",
  "Problem not found": "Problem nicht gefunden",
  "Change not found": "Change nicht gefunden",
  "Could not store the file": "Die Datei konnte nicht gespeichert werden",
  "Could not save the file to the project": "Die Datei konnte nicht im Projekt gespeichert werden",
  "Nothing to save": "Nichts zu speichern",
  "Bad proposal": "Ungültiger Vorschlag",
  "Invalid scope": "Ungültiger Bereich",
  "Pick a team to share with": "Wählen Sie ein Team zum Teilen",
  "You are not a member of that team": "Sie sind kein Mitglied dieses Teams",
  "Triage suggestions are turned off": "Triage-Vorschläge sind ausgeschaltet",
  "Nothing to improve.": "Nichts zu verbessern.",
  "AI request failed": "KI-Anfrage fehlgeschlagen",
  "AI is not configured. Set AI_PROVIDER (and, for external providers, AI_ALLOW_EXTERNAL=true plus the API key).": "KI ist nicht eingerichtet. Setzen Sie AI_PROVIDER (und für externe Anbieter zusätzlich AI_ALLOW_EXTERNAL=true sowie den API-Schlüssel).",
  "You're uploading too quickly. Please wait a moment and try again.": "Sie laden zu schnell hoch. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
  "Missing insight.": "Erkenntnis fehlt.",
  "Insight not found.": "Erkenntnis nicht gefunden.",
  "This insight was already handled.": "Diese Erkenntnis wurde bereits bearbeitet.",
  "Only incident clusters can become a problem.": "Nur Störungs-Cluster können zu einem Problem werden.",
  "Only knowledge gaps can become an article.": "Nur Wissenslücken können zu einem Artikel werden.",
  "Could not apply the change": "Die Änderung konnte nicht übernommen werden",
  "This proposal has already been applied.": "Dieser Vorschlag wurde bereits übernommen.",
  "This proposal is already being applied.": "Dieser Vorschlag wird bereits übernommen.",
  "This proposal is being applied.": "Dieser Vorschlag wird gerade übernommen.",
  "Applied": "Übernommen",
};

export default messages;

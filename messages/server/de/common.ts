import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
const messages: ServerMessages = {
  "Not authorised": "Nicht berechtigt",
  "Not authorised.": "Nicht berechtigt.",
  "Not authenticated": "Nicht angemeldet",
  "Not authenticated.": "Nicht angemeldet.",
  "Please fix the errors below.": "Bitte korrigieren Sie die markierten Felder.",
  "Missing id": "ID fehlt",
  "Something went wrong.": "Etwas ist schiefgelaufen.",
  "Name is required": "Name ist erforderlich",
  "Name is required.": "Name ist erforderlich.",
  "Name must be at least 2 characters.": "Der Name muss mindestens 2 Zeichen lang sein.",
  "Title is required": "Titel ist erforderlich",
  "Title is required.": "Titel ist erforderlich.",
  "Saved": "Gespeichert",
  "Saved.": "Gespeichert.",
  "Deleted": "Gelöscht",
  "Deleted.": "Gelöscht.",
};

export default messages;

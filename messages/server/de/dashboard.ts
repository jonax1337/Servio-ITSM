import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Dashboard, daily briefing, saved views, notifications and shared-component actions.
const messages: ServerMessages = {
  "AI is not configured. Set AI_PROVIDER (and, for external providers, AI_ALLOW_EXTERNAL=true plus the API key).":
    "KI ist nicht konfiguriert. AI_PROVIDER setzen (für externe Anbieter zusätzlich AI_ALLOW_EXTERNAL=true und den API-Schlüssel).",
  "Nothing needs your attention right now.": "Gerade braucht nichts Ihre Aufmerksamkeit.",
  "AI request failed": "KI-Anfrage fehlgeschlagen",
  "Action failed.": "Aktion fehlgeschlagen.",
  "Could not link record.": "Datensatz konnte nicht verknüpft werden.",
  "Could not unlink record.": "Verknüpfung konnte nicht entfernt werden.",
};

export default messages;

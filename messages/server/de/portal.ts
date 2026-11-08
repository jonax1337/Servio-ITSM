import type { ServerMessages } from "../../types";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Portal, survey, sign-in, people and groups actions (and the portal help-center routes).
const messages: ServerMessages = {
  // Sign-in
  "Invalid email or password.": "E-Mail-Adresse oder Passwort ist falsch.",
  // Portal requests & replies
  "Please fix the highlighted fields.": "Bitte korrigieren Sie die markierten Felder.",
  "You're replying too quickly. Please wait a moment and try again.":
    "Sie antworten zu schnell. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
  "You're uploading too quickly. Please wait a moment and try again.":
    "Sie laden zu schnell hoch. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
  "Please complete the required fields.": "Bitte füllen Sie die Pflichtfelder aus.",
  "This item can't be requested.": "Dieser Eintrag kann nicht angefordert werden.",
  "This item requires approval but has no approver configured. Please contact IT.":
    "Für diesen Eintrag ist eine Genehmigung nötig, aber keine genehmigende Person hinterlegt. Bitte wenden Sie sich an die IT.",
  "This item requires approval but its approver is no longer available. Please contact IT.":
    "Für diesen Eintrag ist eine Genehmigung nötig, aber die genehmigende Person ist nicht mehr verfügbar. Bitte wenden Sie sich an die IT.",
  // Portal help-center assistant (confirm-to-create)
  "Couldn't create the request. Please try the request form instead.":
    "Die Anfrage konnte nicht erstellt werden. Bitte nutzen Sie stattdessen das Anfrageformular.",
  "Couldn't post the reply — the ticket may be closed.":
    "Die Antwort konnte nicht gesendet werden – das Ticket ist eventuell geschlossen.",
  "I couldn't find that open ticket of yours.": "Ich konnte dieses offene Ticket von Ihnen nicht finden.",
  "I need a clear title and description first.": "Ich brauche zuerst einen klaren Titel und eine Beschreibung.",
  "No such ticket, or it doesn't belong to you.": "Dieses Ticket gibt es nicht, oder es gehört nicht Ihnen.",
  "Please give a ticket number, e.g. INC-0139.": "Bitte geben Sie eine Ticketnummer an, z. B. INC-0139.",
  "Please give the request a title and a short description first.":
    "Bitte geben Sie der Anfrage zuerst einen Titel und eine kurze Beschreibung.",
  "That service isn't available or is missing required answers.":
    "Dieser Service ist nicht verfügbar oder es fehlen Pflichtangaben.",
  "That service isn't available.": "Dieser Service ist nicht verfügbar.",
  "Too many requests — please wait a moment.": "Zu viele Anfragen – bitte warten Sie einen Moment.",
  // Status page (“This affects me too”)
  "This incident was not found.": "Diese Störung wurde nicht gefunden.",
  "This incident is no longer active.": "Diese Störung ist nicht mehr aktiv.",
  "This incident can't be joined from here. Please open a request instead.":
    "Dieser Störung können Sie sich hier nicht anschließen. Bitte stellen Sie stattdessen eine Anfrage.",
  "The incident ticket has already been closed. Please open a request instead.":
    "Das Störungsticket wurde bereits geschlossen. Bitte stellen Sie stattdessen eine Anfrage.",
  // Survey
  "Invalid survey link.": "Ungültiger Umfrage-Link.",
  "Please pick a rating.": "Bitte wählen Sie eine Bewertung.",
  "This survey link is not valid.": "Dieser Umfrage-Link ist ungültig.",
  // People
  "Enter a valid email address.": "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  "A person with this email already exists.": "Eine Person mit dieser E-Mail-Adresse existiert bereits.",
  "This address is reserved for the system.": "Diese Adresse ist für das System reserviert.",
  "One of the selected groups no longer exists.": "Eine der ausgewählten Gruppen existiert nicht mehr.",
  "Person not found.": "Person nicht gefunden.",
  "Password must be at least 12 characters.": "Das Passwort muss mindestens 12 Zeichen lang sein.",
  "Password must be at most 72 bytes.": "Das Passwort darf höchstens 72 Byte lang sein.",
  // Groups
  "Name must be at least 2 characters": "Der Name muss mindestens 2 Zeichen lang sein",
  "A group with that name already exists.": "Eine Gruppe mit diesem Namen existiert bereits.",
  "Name must be unique": "Der Name muss eindeutig sein",
  "Use a hex colour like #6366f1": "Bitte eine Hex-Farbe wie #6366f1 verwenden",
};

export default messages;

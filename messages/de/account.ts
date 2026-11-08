import type en from "../en/account";
import type { Translations } from "../types";

const account: Translations<typeof en> = {
  dialogTitle: "Kontoeinstellungen",
  profile: "Profil",
  profileDescription: "So sehen Kolleginnen, Kollegen und Anfragende Sie.",
  preferences: "Einstellungen",
  preferencesDescription: "Sprache und Formate für Datum, Uhrzeit und Oberfläche.",
  signature: "Signatur",
  signatureTitle: "E-Mail-Signatur",
  signatureDescription: "Wird an Ihre öffentlichen Ticket-Antworten und ausgehenden E-Mails angehängt.",
  name: "Name",
  email: "E-Mail",
  emailHint: "Wird von Ihrem Identitätsanbieter verwaltet.",
  phone: "Telefon",
  jobTitle: "Position",
  department: "Abteilung",
  timezone: "Zeitzone",
  language: "Sprache",
  languageAuto: "Standard der Instanz ({language})",
  languageHint: "Gilt für Konsole, Portal und E-Mails an Sie.",
  autoAppendSignature: "Signatur automatisch anhängen",
  signatureAria: "E-Mail-Signatur",
  signaturePlaceholder: "z. B. Erika Mustermann — IT-Servicedesk",
  signatureHint: "Wird bei Aktivierung an Ihre öffentlichen Ticket-Antworten und ausgehenden E-Mails angehängt.",
  saved: "Gespeichert",
  saveChanges: "Änderungen speichern",
};

export default account;

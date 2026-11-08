import type en from "../en/categories";
import type { Translations } from "../types";

const categories: Translations<typeof en> = {
  title: "Kategorien",
  description: "Ihre Klassifizierung – Kategorien verschachteln, ein zuständiges Team festlegen und nicht mehr genutzte archivieren.",
  emptyTitle: "Noch keine Kategorien",
  emptyDescription: "Legen Sie eine Kategorie der obersten Ebene an (z. B. Hardware) und ordnen Sie Unterkategorien darunter an.",
  archived: "Archiviert",
  ticketCount: "{count, plural, one {# Ticket} other {# Tickets}}",
  "new.title": "Neue Kategorie",
  "new.description": "Eine Klassifizierung für Tickets, Problems, Changes oder Assets hinzufügen.",
  "edit.title": "Kategorie bearbeiten",
  "edit.description": "Diese Klassifizierung, ihr Team oder ihre Einordnung ändern.",
  archive: "Kategorie archivieren",
  restore: "Kategorie wiederherstellen",
  "delete.title": "Kategorie löschen?",
  "delete.label": "Kategorie löschen",
  "delete.description": "„{name}“ wird endgültig entfernt. Dies kann nicht rückgängig gemacht werden.",
  "form.namePlaceholder": "z. B. Netzwerk, Notebook, Zugang",
  "form.parent": "Übergeordnete Kategorie",
  "form.parentHint": "Unter einer vorhandenen Kategorie einordnen oder als Kategorie der obersten Ebene belassen.",
  "form.topLevel": "— Oberste Ebene —",
  "form.color": "Farbe",
  "form.colorHint": "Hex-Farbe für den Kategoriepunkt.",
  "form.icon": "Symbol",
  "form.team": "Zuständig (Team)",
  "form.teamHint": "Optional. Per API angelegte Tickets ohne Gruppe landen in diesem Team; Sable erkennt daran außerdem, wem die Kategorie gehört.",
  "form.noGroup": "— Keine Gruppe —",
  "form.descriptionPlaceholder": "Optionaler Hinweis, wann diese Kategorie verwendet wird…",
  "form.create": "Kategorie anlegen",
  "form.portalHidden": "Im Portal ausblenden",
  "form.portalHiddenHint": "Nur für das Team, z. B. für Monitoring- oder Security-Alarme: Endbenutzer können sie nicht wählen, und Katalogeinträge darin erscheinen nicht im Portal.",
  portalHidden: "Nur intern",
};

export default categories;

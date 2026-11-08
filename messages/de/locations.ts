import type en from "../en/locations";
import type { Translations } from "../types";

const locations: Translations<typeof en> = {
  title: "Standorte",
  description: "Standorte, Gebäude, Etagen, Räume und Racks im Rechenzentrum – wo sich Ihre Assets befinden.",
  entity: "Standort",
  emptyTitle: "Noch keine Standorte",
  emptyDescription: "Legen Sie Ihren ersten Standort oder Ihr erstes Rechenzentrum an, um Assets nach Standort zu ordnen.",
  backToList: "Zurück zu den Standorten",
  noAddress: "Keine Adresse hinterlegt",
  assetsHere: "Assets an diesem Standort · {count}",
  noAssetsTitle: "Keine Assets",
  noAssetsDescription: "Diesem Standort sind noch keine Assets zugeordnet.",
  "col.asset": "Asset",
  subLocations: "Unterstandorte",
  noSubLocations: "Keine Unterstandorte.",
  "dialog.newTitle": "Neuer Standort",
  "dialog.editTitle": "Standort bearbeiten",
  "dialog.description": "Standorte, Gebäude, Etagen, Räume, Rechenzentren und Racks.",
  "dialog.topLevel": "— Oberste Ebene —",
  "dialog.namePlaceholder": "z. B. Rechenzentrum A / Rack 3",
  "dialog.inside": "Innerhalb von",
  "dialog.searchLocations": "Standorte suchen…",
  "dialog.city": "Ort",
  "dialog.country": "Land",
  "dialog.address": "Adresse",
  "dialog.save": "Standort speichern",
  "dialog.create": "Standort anlegen",
  "delete.title": "Standort löschen",
  "delete.description": "„{name}“ löschen? {consequences}Dies kann nicht rückgängig gemacht werden.",
  "delete.assetsLose": "{count, plural, one {# Asset verliert seinen Standort} other {# Assets verlieren ihren Standort}}",
  "delete.childrenMove": "{count, plural, one {# Unterstandort wird} other {# Unterstandorte werden}} auf die oberste Ebene verschoben",
  "delete.and": " und ",
};

export default locations;

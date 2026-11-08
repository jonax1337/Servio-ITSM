import type en from "../en/nav";
import type { Translations } from "../types";

const nav: Translations<typeof en> = {
  "group.Overview": "Übersicht",
  "group.Service Desk": "Service Desk",
  "group.Catalog": "Katalog",
  "group.CMDB": "CMDB",
  "group.Organisation": "Organisation",
  "group.Administration": "Administration",
  "/": "Dashboard",
  "/assistant": "Sable",
  "/insights": "Erkenntnisse",
  "/tickets": "Tickets",
  "/problems": "Problems",
  "/changes": "Changes",
  "/changes/calendar": "Change-Kalender",
  "/releases": "Releases",
  "/approvals": "Genehmigungen",
  "/oncall": "Rufbereitschaft",
  "/status": "Status",
  "/knowledge": "Wissensdatenbank",
  "/services": "Services",
  "/catalog": "Servicekatalog",
  "/assets": "Assets",
  "/locations": "Standorte",
  "/contracts": "Verträge",
  "/groups": "Gruppen",
  "/people": "Personen",
  "/categories": "Kategorien",
  "/automations": "Automatisierungen",
  "/settings/macros": "Makros",
  "/syncs": "Synchronisierungen",
  "/audit": "Audit-Log",
  "/settings": "Einstellungen",
};

export default nav;

import type en from "../en/errors";
import type { Translations } from "../types";

const errors: Translations<typeof en> = {
  notFoundTitle: "Seite nicht gefunden",
  notFoundText: "Die gesuchte Seite existiert nicht oder wurde verschoben.",
  backToHome: "Zur Startseite",
  errorTitle: "Etwas ist schiefgelaufen",
  errorWithRef: "Ein unerwarteter Fehler ist aufgetreten. Referenz: {digest}",
  errorGeneric: "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.",
  tryAgain: "Erneut versuchen",
  noAccessTitle: "Kein Zugriff",
  accessRestricted: "Zugriff eingeschränkt",
  accessRestrictedText: "Sie haben keine Berechtigung für diesen Bereich.",
  cantAccess: "Kein Zugriff auf diesen Bereich",
  limitedToRole:
    "Dieser Bereich ist ab der Rolle {required} zugänglich. Ihre aktuelle Rolle ist {role}. Wenden Sie sich an eine Administratorin oder einen Administrator, wenn Sie Zugriff benötigen.",
  roleNoPermission:
    "Ihre aktuelle Rolle ({role}) hat keine Berechtigung für diesen Bereich. Wenden Sie sich an eine Administratorin oder einen Administrator, wenn Sie Zugriff benötigen.",
  backToDashboard: "Zum Dashboard",
  maintenanceTitle: "Wartung",
  maintenanceUpdate: "Servio wird gerade aktualisiert und ist in wenigen Minuten wieder verfügbar.",
  maintenanceGeneral: "Servio ist wegen geplanter Wartung nicht verfügbar und in Kürze wieder erreichbar.",
};

export default errors;

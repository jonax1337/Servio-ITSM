import type en from "../en/auth";
import type { Translations } from "../types";

const auth: Translations<typeof en> = {
  pageTitle: "Anmelden",
  heroLine1: "Service,",
  heroLine2: "im Fluss.",
  heroText:
    "Ihr Servicedesk. Ein smarter Kollege im Team. Tickets, Wissen, Changes und Assets an einem Ort – mit Sable an der Seite Ihres Teams.",
  highlightItil: "Tickets, Problems & Changes – durchgängiger ITIL-Prozess",
  highlightCmdb: "CMDB mit Abhängigkeiten zwischen Assets",
  highlightSso: "SSO, Self-Service-Portal und eine saubere REST-API",
  highlightSable: "Sable schlägt vor. Ihr Team behält die Kontrolle.",
  copyright: "© {year} Servio · MIT-Lizenz",
  welcomeBack: "Willkommen zurück",
  signInSubtitle: "Melden Sie sich bei Ihrem Servio-Arbeitsbereich an.",
  continueWith: "Weiter mit {provider}",
  orEmail: "oder mit E-Mail anmelden",
  email: "E-Mail",
  emailPlaceholder: "sie@firma.de",
  password: "Passwort",
  signIn: "Anmelden",
  demoPrefilled: "Demo-Konto vorausgefüllt ·",
  language: "Sprache",
};

export default auth;

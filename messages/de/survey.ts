import type en from "../en/survey";
import type { Translations } from "../types";

const survey: Translations<typeof en> = {
  pageTitle: "Bewerten Sie unseren Support",
  unavailableTitle: "Umfrage nicht verfügbar",
  unavailableText: "Dieser Umfrage-Link ist ungültig oder abgelaufen.",
  thanksTitle: "Vielen Dank für Ihr Feedback!",
  thanksText: "Sie haben diese Anfrage bereits bewertet. Danke, dass Sie sich die Zeit genommen haben.",
  howDidWeDo: "Wie zufrieden waren Sie?",
  requestResolved:
    "Ihre Anfrage <mono>{ref}</mono>{title} wurde gelöst. Bitte bewerten Sie den Support, den Sie erhalten haben.",
  requestTitle: " – „{title}“",
  pleaseRate: "Bitte bewerten Sie den Support, den Sie erhalten haben.",
  copyright: "© {year} Servio · MIT-Lizenz",
  "rating.1": "Sehr unzufrieden",
  "rating.2": "Unzufrieden",
  "rating.3": "Neutral",
  "rating.4": "Zufrieden",
  "rating.5": "Sehr zufrieden",
  ratingAria: "{n} – {label}",
  thankYou: "Vielen Dank!",
  recorded: "Ihr Feedback wurde gespeichert – es hilft uns, besser zu werden.",
  alreadySubmitted: "Bereits abgegeben",
  alreadyAnswered: "Diese Umfrage wurde bereits beantwortet. Vielen Dank!",
  tapToRate: "Tippen Sie auf einen Stern, um zu bewerten",
  anythingElse: "Möchten Sie noch etwas ergänzen? (optional)",
  commentPlaceholder: "Was lief gut? Was können wir besser machen?",
  submitFeedback: "Feedback absenden",
};

export default survey;

import type en from "../en/insights";
import type { Translations } from "../types";

const insights: Translations<typeof en> = {
  title: "Erkenntnisse",
  description: "Muster, die Sable in Ihren Tickets erkannt hat: wiederkehrende Störungen, aus denen ein Problem werden sollte, und Lösungen, die es wert sind, dokumentiert zu werden.",
  incidentClusters: "Störungs-Cluster",
  knowledgeGaps: "Wissenslücken",
  emptyTitle: "Gerade nichts zu tun",
  emptyDescription: "Erkenntnisse erscheinen hier, wenn Sable wiederkehrende Störungen oder nie dokumentierte Lösungen bemerkt.",
  recentlyHandled: "Kürzlich bearbeitet",
};

export default insights;

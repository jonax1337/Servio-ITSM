import type { NoticeTextFn } from "@/lib/notification-email-rules";

/**
 * German built-in defaults for the ticket emails (lib/email-templates.ts). Used when the
 * recipient's language is German and the admin has not overridden the template in
 * Settings › Email templates (an override is used for every recipient as written).
 * Same {{placeholders}} as the English defaults — the i18n catalog test checks that.
 */
export const emailTemplatesDe = {
  ticket_received: {
    subject: "[{{ref}}] Wir haben Ihre Anfrage erhalten",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>vielen Dank für Ihre Nachricht — wir haben Ihre Anfrage unter <strong>{{ref}}</strong> erfasst und melden uns so schnell wie möglich.</p>` +
      `<p>Sie können jederzeit auf diese E-Mail antworten.</p>`,
  },
  ticket_reply: {
    subject: "[{{ref}}] {{title}}",
    bodyHtml: `{{message}}{{signature}}{{quote}}`,
  },
  ticket_resolved: {
    subject: "[{{ref}}] Gelöst: {{title}}",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>gute Nachrichten — Ihre Anfrage <strong>{{ref}}</strong> wurde als <strong>gelöst</strong> markiert. Falls noch etwas offen ist, antworten Sie einfach auf diese E-Mail.</p>` +
      `{{resolution}}` +
      `{{autoCloseNotice}}` +
      `{{survey}}`,
  },
  ticket_participant: {
    subject: "[{{ref}}] Sie wurden zu einem Ticket hinzugefügt",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>{{agentName}} hat Sie zu <strong>{{ref}}</strong> — „{{title}}“ — hinzugefügt. Sie erhalten ab jetzt Updates und können auf diese E-Mail antworten.</p>` +
      `{{message}}`,
  },
  ticket_assigned: {
    subject: "[{{ref}}] Ihnen zugewiesen: {{title}}",
    bodyHtml:
      `<p>Hallo {{agentName}},</p>` +
      `<p>das Ticket <strong>{{ref}}</strong> — „{{title}}“ — wurde Ihnen zugewiesen. Bitte sehen Sie es sich an und übernehmen Sie den nächsten Schritt.</p>`,
  },
  ticket_closed: {
    subject: "[{{ref}}] Geschlossen: {{title}}",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>Ihre Anfrage <strong>{{ref}}</strong> — „{{title}}“ — ist jetzt <strong>geschlossen</strong>. Wenn Sie noch etwas brauchen, antworten Sie einfach auf diese E-Mail oder stellen Sie eine neue Anfrage.</p>`,
  },
  approval_request: {
    subject: "[{{ref}}] Genehmigung erforderlich: {{itemName}}",
    bodyHtml:
      `<p>Hallo {{approverName}},</p>` +
      `<p>{{requesterName}} hat <strong>{{itemName}}</strong> ({{ref}}) angefordert. Die Anfrage braucht Ihre Genehmigung{{stage}}.</p>` +
      `{{details}}` +
      `<p>Bitte genehmigen oder lehnen Sie sie in {{appName}} unter „Genehmigungen“ ab.</p>`,
  },
  request_approved: {
    subject: "[{{ref}}] Ihre Anfrage wurde genehmigt",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>Ihre Anfrage <strong>{{itemName}}</strong> ({{ref}}) wurde genehmigt und wird jetzt bearbeitet.</p>` +
      `{{comment}}`,
  },
  notification: {
    subject: "{{subject}}",
    bodyHtml:
      `<p>Hallo {{recipientName}},</p>` +
      `<p>{{message}}</p>` +
      `{{details}}` +
      `{{link}}` +
      `<p>Sie erhalten diese E-Mail aufgrund Ihrer Benachrichtigungseinstellungen in {{appName}} (Kontoeinstellungen › Benachrichtigungen).</p>`,
  },
  request_rejected: {
    subject: "[{{ref}}] Ihre Anfrage wurde abgelehnt",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>Ihre Anfrage <strong>{{itemName}}</strong> ({{ref}}) wurde leider abgelehnt.</p>` +
      `{{comment}}` +
      `<p>Wenn Sie sie weiterhin benötigen, können Sie im Portal eine neue Anfrage stellen.</p>`,
  },
  inbound_rejected: {
    subject: "Ihre E-Mail konnte nicht angenommen werden",
    bodyHtml:
      `<p>Guten Tag,</p>` +
      `<p>vielen Dank für Ihre Nachricht. Dieses Postfach nimmt neue Anfragen nur von registrierten Adressen an, daher wurde aus Ihrer E-Mail kein Ticket erstellt.</p>` +
      `<p>Bitte stellen Sie Ihre Anfrage stattdessen über das Portal von {{appName}}.</p>` +
      `{{link}}`,
  },
} as const;

/** The link label of the notification email. */
export const noticeLinkDe = (appName: string) => `In ${appName} öffnen`;

export const portalLinkDe = (appName: string) => `Zum Portal von ${appName}`;

/** German wording of the notification emails (English: lib/notification-email-rules.ts). */
export const noticeTextDe: NoticeTextFn = (notice, { ref = "", title = "" }, formatDate) => {
  switch (notice.kind) {
    case "TICKET_UNASSIGNED":
      return {
        subject: `[${ref}] Neues Ticket ohne Bearbeiter in ${notice.groupName}: ${title}`,
        message: `Das Ticket ${ref} — „${title}“ — liegt in ${notice.groupName}, und noch niemand bearbeitet es.`,
      };
    case "REQUESTER_REPLY":
      return {
        subject: `[${ref}] ${notice.authorName} hat geantwortet: ${title}`,
        message: `${notice.authorName} hat auf das Ticket ${ref} — „${title}“ — geantwortet:`,
        details: notice.snippet,
      };
    case "SLA_ESCALATION":
      return {
        subject: `[${ref}] SLA-Eskalation: ${notice.percent} % verstrichen`,
        message: `Das Ticket ${ref} — „${title}“ — hat ${notice.percent} % seines SLA verbraucht.`,
      };
    case "SLA_NUDGE":
      return notice.percent >= 100
        ? { subject: `[${ref}] SLA überschritten: ${title}`, message: `Die Lösungsfrist Ihres Tickets ${ref} — „${title}“ — ist abgelaufen.` }
        : {
            subject: `[${ref}] SLA-Zeit wird knapp: ${title}`,
            message: `Ihr Ticket ${ref} — „${title}“ — hat ${notice.percent} % seiner Lösungszeit verbraucht.`,
          };
    case "CONTRACT_RENEWAL":
      return {
        subject: `Vertrag „${notice.name}“ endet am ${formatDate(notice.endDate)}`,
        message: `Der Vertrag „${notice.name}“, für den Sie verantwortlich sind, endet am ${formatDate(notice.endDate)}. ${
          notice.autoRenew
            ? "Er verlängert sich automatisch, wenn Sie ihn nicht rechtzeitig kündigen."
            : "Er läuft aus, wenn Sie ihn nicht verlängern."
        }`,
      };
    case "LICENSE_OVER_ALLOCATED":
      return {
        subject: `Lizenz „${notice.name}“ ist überbelegt`,
        message: `Für die Lizenz „${notice.name}“, für die Sie verantwortlich sind, sind ${notice.used} Plätze zugewiesen, aber nur ${notice.seats} gekauft.`,
      };
    case "RECURRING_FAILED":
      return {
        subject: `Wiederkehrendes Ticket „${notice.name}“ konnte sein Ticket nicht anlegen`,
        message: `Das von Ihnen angelegte wiederkehrende Ticket „${notice.name}“ konnte sein Ticket nicht anlegen:`,
        details: notice.error,
      };
  }
};

/** The {{stage}} text of the approval email (multi-stage approvals only). */
export const approvalStageDe = (stage: number, of: number) => ` (Stufe ${stage} von ${of})`;

/** The {{autoCloseNotice}} sentence of the resolved email. */
export const autoCloseNoticeDe = (days: number) =>
  `Wenn wir nichts mehr von Ihnen hören, wird das Ticket in ${days} ${days === 1 ? "Tag" : "Tagen"} automatisch geschlossen.`;

/** The CSAT call to action under the resolved email. */
export const surveyCtaDe = { question: "Wie zufrieden waren Sie?", link: "Support bewerten" };

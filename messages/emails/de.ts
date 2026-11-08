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
  request_rejected: {
    subject: "[{{ref}}] Ihre Anfrage wurde abgelehnt",
    bodyHtml:
      `<p>Hallo {{requesterName}},</p>` +
      `<p>Ihre Anfrage <strong>{{itemName}}</strong> ({{ref}}) wurde leider abgelehnt.</p>` +
      `{{comment}}` +
      `<p>Wenn Sie sie weiterhin benötigen, können Sie im Portal eine neue Anfrage stellen.</p>`,
  },
} as const;

/** The {{stage}} text of the approval email (multi-stage approvals only). */
export const approvalStageDe = (stage: number, of: number) => ` (Stufe ${stage} von ${of})`;

/** The {{autoCloseNotice}} sentence of the resolved email. */
export const autoCloseNoticeDe = (days: number) =>
  `Wenn wir nichts mehr von Ihnen hören, wird das Ticket in ${days} ${days === 1 ? "Tag" : "Tagen"} automatisch geschlossen.`;

/** The CSAT call to action under the resolved email. */
export const surveyCtaDe = { question: "Wie zufrieden waren Sie?", link: "Support bewerten" };

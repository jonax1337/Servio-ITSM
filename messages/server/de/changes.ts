import type { ServerMessages } from "../../types";
import { CHANGE_STATUSES, CHANGE_STATUS_META, RELEASE_STATUSES, RELEASE_STATUS_META } from "@/lib/constants";
import { enumsDe } from "../../de/enums";

// English server message (exact text) → German. See docs/i18n.md#server-messages.
// Changes, releases, approvals.
const fixed: ServerMessages = {
  "A closed or cancelled change cannot join a release.": "Ein abgeschlossener oder stornierter Change kann keinem Release hinzugefügt werden.",
  "A failed change needs the outcome Failed or Rolled back.": "Ein fehlgeschlagener Change braucht das Ergebnis „Fehlgeschlagen“ oder „Zurückgerollt“.",
  "A freeze window must end after it starts.": "Ein Freeze-Zeitraum muss nach seinem Beginn enden.",
  "A standard change is pre-authorized by its template and has no approval board.": "Ein Standard-Change ist durch seine Vorlage vorab genehmigt und hat kein Genehmigungsgremium.",
  "A standard template needs an implementation plan and a rollback plan, because its changes skip CAB review.": "Eine Standard-Vorlage braucht einen Umsetzungs- und einen Rückfallplan, da ihre Changes die CAB-Prüfung überspringen.",
  "A template with this name already exists.": "Eine Vorlage mit diesem Namen existiert bereits.",
  "AI is not configured. Set AI_PROVIDER (and, for external providers, AI_ALLOW_EXTERNAL=true plus the API key).": "KI ist nicht konfiguriert. Setzen Sie AI_PROVIDER (und für externe Anbieter AI_ALLOW_EXTERNAL=true sowie den API-Schlüssel).",
  "AI request failed": "KI-Anfrage fehlgeschlagen",
  "Add a short reason to reschedule an approved change.": "Geben Sie einen kurzen Grund an, um einen genehmigten Change zu verschieben.",
  "Add closure notes (post-implementation review or lessons learned).": "Fügen Sie Abschlussnotizen hinzu (Nachbetrachtung oder Lessons Learned).",
  "An approved change must keep its planned window; move the dates instead of clearing them.": "Ein genehmigter Change muss sein geplantes Zeitfenster behalten; verschieben Sie die Termine, statt sie zu leeren.",
  "An approver who has already decided can't be removed.": "Eine genehmigende Person, die bereits entschieden hat, kann nicht entfernt werden.",
  "Approval request not found.": "Genehmigungsanfrage nicht gefunden.",
  "Approvers can only be added while the change is a draft or in approval.": "Genehmigende können nur hinzugefügt werden, solange der Change ein Entwurf oder in Genehmigung ist.",
  "Approvers can only be removed while the change is a draft or in approval.": "Genehmigende können nur entfernt werden, solange der Change ein Entwurf oder in Genehmigung ist.",
  "Bundle at least one change before the release can go ahead.": "Bündeln Sie mindestens einen Change, bevor das Release fortgesetzt werden kann.",
  "Category not found.": "Kategorie nicht gefunden.",
  "Change not found": "Change nicht gefunden",
  "Change not found.": "Change nicht gefunden.",
  "Choose a valid outcome.": "Wählen Sie ein gültiges Ergebnis.",
  "Choose an outcome before closing the change.": "Wählen Sie ein Ergebnis, bevor Sie den Change abschließen.",
  "Emergency changes need a post-implementation review (closure notes) first.": "Notfall-Changes brauchen zuerst eine Nachbetrachtung (Abschlussnotizen).",
  "Enter a valid date.": "Geben Sie ein gültiges Datum ein.",
  "Freeze window not found.": "Freeze-Zeitraum nicht gefunden.",
  "Give a reason for cancelling the change.": "Geben Sie einen Grund für die Stornierung des Changes an.",
  "Invalid request": "Ungültige Anfrage",
  "Invalid request.": "Ungültige Anfrage.",
  "Name must be at least 3 characters": "Der Name muss mindestens 3 Zeichen lang sein",
  "No changes bundled yet.": "Noch keine Changes gebündelt.",
  "No eligible CAB approvers are available for this change.": "Für diesen Change sind keine infrage kommenden CAB-Genehmigenden verfügbar.",
  "One of the selected configuration items no longer exists.": "Eines der ausgewählten Configuration Items existiert nicht mehr.",
  "Only a draft change can be submitted for approval.": "Nur ein Change im Entwurf kann zur Genehmigung eingereicht werden.",
  "Only managers can change the approval board.": "Nur Manager können das Genehmigungsgremium ändern.",
  "Only managers can change the approval rule.": "Nur Manager können die Genehmigungsregel ändern.",
  "Only managers can manage change freeze windows.": "Nur Manager können Freeze-Zeiträume verwalten.",
  "Only the assigned approver can decide this request.": "Nur die zugewiesene genehmigende Person kann über diese Anfrage entscheiden.",
  "Planned end must be after the planned start.": "Das geplante Ende muss nach dem geplanten Beginn liegen.",
  "Problem not found.": "Problem nicht gefunden.",
  "Service not found.": "Service nicht gefunden.",
  "Standard changes are created from an approved template.": "Standard-Changes werden aus einer genehmigten Vorlage angelegt.",
  "Team not found.": "Team nicht gefunden.",
  "Template not found.": "Vorlage nicht gefunden.",
  "Only a role that may approve changes of this risk can save an active standard template, because its changes skip CAB review.":
    "Nur eine Rolle, die Changes dieses Risikos genehmigen darf, kann eine aktive Standard-Vorlage speichern, weil deren Changes das CAB überspringen.",
  "That approval request was already decided or removed. Reload and try again.": "Diese Genehmigungsanfrage wurde bereits entschieden oder entfernt. Laden Sie die Seite neu und versuchen Sie es erneut.",
  "The approval rule can only be changed while the change is a draft or in approval.": "Die Genehmigungsregel kann nur geändert werden, solange der Change ein Entwurf oder in Genehmigung ist.",
  "The assignee must be a member of the change's group.": "Die bearbeitende Person muss Mitglied der Gruppe des Changes sein.",
  "The change owner or creator cannot approve their own change.": "Verantwortliche oder Ersteller eines Changes können ihn nicht selbst genehmigen.",
  "The change was updated by someone else. Reload and try again.": "Der Change wurde von jemand anderem geändert. Laden Sie die Seite neu und versuchen Sie es erneut.",
  "This approval request has already been decided or withdrawn.": "Diese Genehmigungsanfrage wurde bereits entschieden oder zurückgezogen.",
  "This change is already part of the release.": "Dieser Change ist bereits Teil des Release.",
  "This change is not awaiting approval yet.": "Dieser Change wartet noch nicht auf Genehmigung.",
  "This emergency change falls inside a freeze window. Add a justification for overriding it.": "Dieser Notfall-Change liegt in einem Freeze-Zeitraum. Begründen Sie, warum er den Freeze-Zeitraum übergeht.",
  "This release is ready. Move it back to Planning to change its bundle.": "Dieses Release ist bereit. Setzen Sie es zurück auf „In Planung“, um seine Changes zu ändern.",
  "This request has already been decided or withdrawn.": "Diese Anfrage wurde bereits entschieden oder zurückgezogen.",
  "This request was withdrawn, so there is nothing left to decide.": "Diese Anfrage wurde zurückgezogen, es gibt nichts mehr zu entscheiden.",
  "Title must be at least 3 characters": "Der Titel muss mindestens 3 Zeichen lang sein",
  "Title must be at least 3 characters.": "Der Titel muss mindestens 3 Zeichen lang sein.",
  "You are not signed in as an agent.": "Sie sind nicht als Agent angemeldet.",
  "You can't approve a change you requested or own. Another approver has to decide it.": "Sie können keinen Change genehmigen, den Sie beantragt haben oder verantworten. Eine andere genehmigende Person muss entscheiden.",
  "Your role cannot self-approve a change of this risk. Another approver has to decide it.": "Ihre Rolle darf einen Change mit diesem Risiko nicht selbst genehmigen. Eine andere genehmigende Person muss entscheiden.",
  "A self-approval needs a comment that justifies deciding your own change.": "Eine Selbstgenehmigung braucht einen Kommentar, der begründet, warum Sie über Ihren eigenen Change entscheiden.",
  "You can't approve a request you raised yourself. Another approver has to decide it.": "Sie können keine Anfrage genehmigen, die Sie selbst gestellt haben. Eine andere genehmigende Person muss entscheiden.",
  "You cannot change the approval board of a change you own or created.": "Sie können das Genehmigungsgremium eines Changes, den Sie verantworten oder angelegt haben, nicht ändern.",
  "You cannot set the approval rule on a change you own or created.": "Sie können die Genehmigungsregel eines Changes, den Sie verantworten oder angelegt haben, nicht festlegen.",
};

// Messages that lib/change-rules.ts and lib/release-rules.ts build from a status label: the status
// sets are finite, so every variant is listed here instead of needing a pattern.
const changeLabel = (s: string) => CHANGE_STATUS_META[s]?.label ?? s;
const changeDe = (s: string) => (enumsDe.CHANGE_STATUS_META as Record<string, string>)[s] ?? s;
const releaseLabel = (s: string) => RELEASE_STATUS_META[s]?.label ?? s;
const releaseDe = (s: string) => (enumsDe.RELEASE_STATUS_META as Record<string, string>)[s] ?? s;

const generated: ServerMessages = {};
for (const status of CHANGE_STATUSES) {
  const en = changeLabel(status);
  const de = changeDe(status);
  generated[`The planned window can't be changed while the change is ${en.toLowerCase()}.`] =
    `Das geplante Zeitfenster kann im Status „${de}“ nicht geändert werden.`;
  generated[`This change is ${en.toLowerCase()} and can no longer be edited. Comments and links can still be added.`] =
    `Dieser Change hat den Status „${de}“ und kann nicht mehr bearbeitet werden. Kommentare und Verknüpfungen sind weiterhin möglich.`;
  generated[`${en} is set by the approval workflow. Use "Submit for approval" instead.`] =
    `„${de}“ wird vom Genehmigungs-Workflow gesetzt. Verwenden Sie stattdessen „Zur Genehmigung einreichen“.`;
}

// submitBlockedMessage: every ordered subset of the three prerequisites.
const SUBMIT_PARTS: [string, string][] = [
  ["an implementation plan", "einen Umsetzungsplan"],
  ["a rollback plan", "einen Rückfallplan"],
  ["a planned window (start and end)", "ein geplantes Zeitfenster (Beginn und Ende)"],
];
const joinList = (items: string[], and: string) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}` : items[0];
for (let mask = 1; mask < 1 << SUBMIT_PARTS.length; mask++) {
  const parts = SUBMIT_PARTS.filter((_, i) => mask & (1 << i));
  generated[`Cannot submit for approval: add ${joinList(parts.map((p) => p[0]), "and")} first.`] =
    `Einreichen zur Genehmigung nicht möglich: Fügen Sie zuerst ${joinList(parts.map((p) => p[1]), "und")} hinzu.`;
}

for (const status of RELEASE_STATUSES) {
  const en = releaseLabel(status);
  const de = releaseDe(status);
  generated[`The bundle can't be changed while the release is ${en.toLowerCase()}.`] =
    `Die gebündelten Changes können nicht geändert werden, solange das Release den Status „${de}“ hat.`;
  generated[`This release is ${en.toLowerCase()} and can no longer be edited.`] =
    `Dieses Release hat den Status „${de}“ und kann nicht mehr bearbeitet werden.`;
  for (const to of RELEASE_STATUSES) {
    generated[`A release cannot move from ${en} to ${releaseLabel(to)}.`] =
      `Ein Release kann nicht von „${de}“ zu „${releaseDe(to)}“ wechseln.`;
  }
}

const messages: ServerMessages = { ...generated, ...fixed };

export default messages;

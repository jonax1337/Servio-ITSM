/** Why a ticket field change is refused — surfaced to the agent instead of a silent no-op. */
export const NOT_YOUR_TICKET = "You can't change this ticket — it belongs to a group you're not a member of.";
export const AWAITING_APPROVAL = "This request is awaiting approval; it can only be cancelled until it is decided.";
export const TRANSITION_NOT_ALLOWED = "The status workflow doesn't allow this change.";
export const ASSIGNEE_NOT_IN_GROUP = "That agent isn't a member of the ticket's group.";

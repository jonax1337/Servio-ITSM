/**
 * Enter confirms a dialog. Inside a rich-text note Enter starts a new paragraph and
 * on a control it keeps its own meaning (activate, open), so those need Ctrl/Cmd+Enter.
 */

export type ConfirmKeyEvent = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
export type KeyTarget = { inEditor: boolean; onControl: boolean };

export function isConfirmShortcut(event: ConfirmKeyEvent, target: KeyTarget): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.ctrlKey || event.metaKey) return true;
  return !target.inEditor && !target.onControl;
}

const CONTROL_SELECTOR = "button, a, input, textarea, select, [role=combobox], [role=checkbox], [role=option]";

/** Where a key event came from, for {@link isConfirmShortcut}. */
export function keyTargetOf(element: EventTarget | null): KeyTarget {
  const el = element instanceof Element ? element : null;
  return { inEditor: !!el?.closest(".ProseMirror"), onControl: !!el?.closest(CONTROL_SELECTOR) };
}

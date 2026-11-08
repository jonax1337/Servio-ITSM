/** Shared composite components (components/*.tsx outside module folders) and UI primitives. */
const components = {
  vipHint: "Priority handling",
  // ListToolbar — {filter} is the filter's label ("priority" in English, the label as is elsewhere)
  "toolbar.search": "Search…",
  "toolbar.all": "All {filter}",
  "toolbar.searchFilter": "Search {filter}…",
  "toolbar.clear": "Clear",
  // PaginationBar
  "pagination.range": "{from}–{to} of {total}",
  "pagination.prev": "Prev",
  "pagination.next": "Next",
  // ConfirmButton / ConfirmDialog defaults
  "confirm.delete": "Delete",
  "confirm.cancel": "Cancel",
  "confirm.failed": "Action failed.",
  // Combobox / ComboField / MultiCombobox defaults
  "combo.select": "Select…",
  "combo.search": "Search…",
  "combo.empty": "No results found.",
  "combo.none": "— None —",
  "combo.selected": "Selected",
  "combo.remove": "Remove {label}",
  // SavedViewsBar
  "views.all": "All",
  "views.deleteTitle": "Delete view?",
  "views.deleteDescription": "The saved view \"{name}\" will be permanently deleted.",
  "views.deleteLabel": "Delete view {name}",
  "views.saveHint": "Save the current filters as a view",
  "views.applyFilterFirst": "Apply a filter first",
  "views.save": "Save view",
  "views.saveDescription": "Save the current filters as a named view for quick access.",
  "views.name": "Name",
  "views.namePlaceholder": "e.g. My open criticals",
  "views.shareWithTeam": "Share with a team",
  "views.everyone": "Everyone (all teams)",
  "views.chooseTeam": "Choose a team",
  "views.searchTeams": "Search teams…",
  // LinkPicker / LinkedChip
  "link.nothingToLink": "Nothing available to link.",
  "link.failed": "Could not link record.",
  "link.relationship": "Relationship",
  "link.searchTypes": "Search types…",
  "link.choose": "Choose…",
  "link.submit": "Link",
  "link.unlinked": "Unlinked",
  "link.unlinkFailed": "Could not unlink record.",
  "link.unlink": "Unlink",
  // EntityTabs
  "tabs.needsAttention": "Needs attention",
  // EditEntityDialog / EditableTextCard — {entity} is the record kind or the card label
  "edit.record": "record",
  "edit.title": "Edit {entity}",
  // NotificationsMenu
  "notifications.title": "Notifications",
  "notifications.markAllRead": "Mark all read",
  "notifications.empty": "You're all caught up.",
  "notifications.markRead": "Mark as read",
  // UI primitives (components/ui)
  "ui.close": "Close",
  "ui.more": "More",
  "ui.commandTitle": "Command Palette",
  "ui.commandDescription": "Search for a command to run...",
  "ui.sidebar": "Sidebar",
  "ui.sidebarDescription": "Displays the mobile sidebar.",
  "ui.toggleSidebar": "Toggle Sidebar",
  // RichTextEditor toolbar
  "editor.formatting": "Formatting",
  "editor.paragraph": "Paragraph",
  "editor.heading2": "Heading 2",
  "editor.heading3": "Heading 3",
  "editor.bold": "Bold",
  "editor.italic": "Italic",
  "editor.underline": "Underline",
  "editor.bulletList": "Bullet list",
  "editor.numberedList": "Numbered list",
  "editor.link": "Link",
  "editor.removeLink": "Remove",
  "editor.addLink": "Add",
};

export default components;

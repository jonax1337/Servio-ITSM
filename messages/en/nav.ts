/**
 * Console navigation (lib/nav.ts). Items are keyed by their href, groups by `group.<label>`,
 * so a new nav entry only needs its href added here and in messages/de/nav.ts
 * (tests/unit/i18n-nav.test.ts checks that every entry is covered).
 */
const nav = {
  "group.Overview": "Overview",
  "group.Service Desk": "Service Desk",
  "group.Catalog": "Catalog",
  "group.CMDB": "CMDB",
  "group.Organisation": "Organisation",
  "group.Administration": "Administration",
  "/": "Dashboard",
  "/assistant": "Sable",
  "/insights": "Insights",
  "/tickets": "Tickets",
  "/problems": "Problems",
  "/changes": "Changes",
  "/changes/calendar": "Change Calendar",
  "/releases": "Releases",
  "/approvals": "Approvals",
  "/oncall": "On-call",
  "/status": "Status",
  "/knowledge": "Knowledge Base",
  "/services": "Services",
  "/catalog": "Service Catalog",
  "/assets": "Assets",
  "/locations": "Locations",
  "/contracts": "Contracts",
  "/groups": "Groups",
  "/people": "People",
  "/categories": "Categories",
  "/automations": "Automations",
  "/settings/macros": "Macros",
  "/syncs": "Syncs",
  "/audit": "Audit Log",
  "/settings": "Settings",
};

export default nav;

// Single source of truth for the "enum" string fields (SQLite has no enums).
// Each domain exports: the allowed values, human labels, a badge tone, and an icon.
import type { LucideIcon } from "lucide-react";
import type { UpdaterState } from "@/lib/maintenance-rules";
import {
  ArrowDown, Minus, ArrowUp, Flame,
  Sparkle, CircleDot, Clock, PauseCircle, CheckCircle2, CircleCheck, XCircle, Ban,
  AlertTriangle, Wrench, Search, ShieldAlert,
  FileEdit, Send, ThumbsUp, CalendarClock, PlayCircle,
  TriangleAlert, CircleSlash, Crown, Undo2,
  MapPin, Building2, Layers, DoorClosed, Server, Rows3,
  Lock, Globe,
  Target, Eye, Rocket, Boxes, BookOpen, CalendarX2, PhoneCall, Repeat,
} from "lucide-react";

export type Tone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "purple"
  | "indigo";

export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  purple:
    "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  indigo:
    "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
};

export type Meta = { label: string; tone: Tone; icon?: LucideIcon };

/**
 * Tone-derived classes for full-width status banners (background tint only —
 * content keeps its own colours) and for standalone accent icons/text.
 * Derived from the same palette as TONE_CLASSES so banners/chips stay on-token
 * without hand-picking raw palette utilities at the call site.
 */
export const TONE_BANNER_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted/40",
  info: "bg-sky-500/5",
  success: "bg-emerald-500/5",
  warning: "bg-amber-500/5",
  danger: "bg-red-500/5",
  purple: "bg-purple-500/5",
  indigo: "bg-indigo-500/5",
};

export const TONE_TEXT_CLASSES: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  info: "text-sky-500 dark:text-sky-400",
  success: "text-emerald-500 dark:text-emerald-400",
  warning: "text-amber-500 dark:text-amber-400",
  danger: "text-destructive",
  purple: "text-purple-500 dark:text-purple-400",
  indigo: "text-indigo-500 dark:text-indigo-400",
};

// ---- Roles ----------------------------------------------------------------
export const ROLES = ["ADMIN", "MANAGER", "AGENT", "USER"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_META: Record<Role, Meta> = {
  ADMIN: { label: "Administrator", tone: "danger" },
  MANAGER: { label: "Manager", tone: "purple" },
  AGENT: { label: "Agent", tone: "indigo" },
  USER: { label: "User", tone: "neutral" },
};

// ---- Ticket ---------------------------------------------------------------
export const TICKET_TYPES = ["INCIDENT", "REQUEST"] as const;
export const TICKET_TYPE_META: Record<string, Meta> = {
  INCIDENT: { label: "Incident", tone: "danger", icon: AlertTriangle },
  REQUEST: { label: "Service Request", tone: "info", icon: Send },
};

export const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "PENDING",
  "ON_HOLD",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
] as const;
export const TICKET_STATUS_META: Record<string, Meta> = {
  NEW: { label: "New", tone: "info", icon: Sparkle },
  OPEN: { label: "Open", tone: "indigo", icon: CircleDot },
  IN_PROGRESS: { label: "In Progress", tone: "purple", icon: PlayCircle },
  PENDING: { label: "Pending", tone: "warning", icon: Clock },
  ON_HOLD: { label: "On Hold", tone: "warning", icon: PauseCircle },
  RESOLVED: { label: "Resolved", tone: "success", icon: CheckCircle2 },
  CLOSED: { label: "Closed", tone: "neutral", icon: CircleCheck },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: Ban },
};
export const OPEN_TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "PENDING",
  "ON_HOLD",
] as const;

// Statuses that require a pending reason
export const PENDING_STATUSES = ["PENDING", "ON_HOLD"] as const;
export const PENDING_REASONS = [
  "AWAITING_CUSTOMER",
  "AWAITING_VENDOR",
  "AWAITING_CHANGE",
  "AWAITING_PARTS",
  "SCHEDULED",
] as const;
export const PENDING_REASON_META: Record<string, Meta> = {
  AWAITING_CUSTOMER: { label: "Awaiting customer", tone: "info", icon: Clock },
  AWAITING_VENDOR: { label: "Awaiting vendor", tone: "purple", icon: Clock },
  AWAITING_CHANGE: { label: "Awaiting change", tone: "indigo", icon: Clock },
  AWAITING_PARTS: { label: "Awaiting parts", tone: "warning", icon: Clock },
  SCHEDULED: { label: "Scheduled", tone: "neutral", icon: CalendarClock },
};

// Resolution codes (on resolve/close)
export const RESOLUTION_CODES = [
  "FIXED",
  "WORKAROUND",
  "NOT_REPRODUCIBLE",
  "DUPLICATE",
  "NO_ACTION",
] as const;
export const RESOLUTION_CODE_META: Record<string, Meta> = {
  FIXED: { label: "Fixed", tone: "success", icon: CheckCircle2 },
  WORKAROUND: { label: "Workaround", tone: "info", icon: ShieldAlert },
  NOT_REPRODUCIBLE: { label: "Not reproducible", tone: "neutral", icon: Search },
  DUPLICATE: { label: "Duplicate", tone: "warning", icon: CircleCheck },
  NO_ACTION: { label: "No action needed", tone: "neutral", icon: Ban },
};

/** The AI assistant's name — used consistently across chat, triage, and prompts. */
export const AI_ASSISTANT_NAME = "Sable";

/**
 * Application version (shown in the sidebar footer and Settings › About).
 * `pnpm release X.Y.Z` (scripts/release.mjs) bumps it together with package.json
 * and updater/package.json; a unit test keeps the three equal.
 */
export const APP_VERSION = "0.6.1";

/** Scope of a standalone Sable conversation (String-enum strategy). */
export const AI_SCOPES = ["GENERAL", "ADMIN"] as const;

/** Shown when AI buttons are rendered in "teaser" mode (visible but not enabled). */
export const AI_TEASER_MESSAGE =
  "✨ AI features are available here — an admin can enable them in your Servio configuration.";

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const PRIORITY_META: Record<string, Meta> = {
  LOW: { label: "Low", tone: "success", icon: ArrowDown },
  MEDIUM: { label: "Medium", tone: "info", icon: Minus },
  HIGH: { label: "High", tone: "warning", icon: ArrowUp },
  CRITICAL: { label: "Critical", tone: "danger", icon: Flame },
};

export const IMPACT_URGENCY = ["LOW", "MEDIUM", "HIGH"] as const;
export const LEVEL_META: Record<string, Meta> = {
  LOW: { label: "Low", tone: "neutral" },
  MEDIUM: { label: "Medium", tone: "info" },
  HIGH: { label: "High", tone: "warning" },
};

export const TICKET_SOURCES = [
  "PORTAL",
  "SABLE",
  "EMAIL",
  "PHONE",
  "API",
  "AGENT",
  "RECURRING",
] as const;
export const SOURCE_META: Record<string, Meta> = {
  PORTAL: { label: "Portal", tone: "info" },
  SABLE: { label: AI_ASSISTANT_NAME, tone: "neutral", icon: Sparkle },
  EMAIL: { label: "Email", tone: "purple" },
  PHONE: { label: "Phone", tone: "indigo" },
  API: { label: "API", tone: "neutral" },
  AGENT: { label: "Agent", tone: "neutral" },
  RECURRING: { label: "Recurring", tone: "indigo", icon: Repeat },
};

// ---- Problem --------------------------------------------------------------
export const PROBLEM_STATUSES = [
  "NEW",
  "INVESTIGATING",
  "KNOWN_ERROR",
  "RESOLVED",
  "CLOSED",
] as const;
export const PROBLEM_STATUS_META: Record<string, Meta> = {
  NEW: { label: "New", tone: "info", icon: Sparkle },
  INVESTIGATING: { label: "Investigating", tone: "indigo", icon: Search },
  KNOWN_ERROR: { label: "Known Error", tone: "warning", icon: ShieldAlert },
  RESOLVED: { label: "Resolved", tone: "success", icon: CheckCircle2 },
  CLOSED: { label: "Closed", tone: "neutral", icon: CircleCheck },
};

// ---- Change ---------------------------------------------------------------
export const CHANGE_TYPES = ["STANDARD", "NORMAL", "EMERGENCY"] as const;
export const CHANGE_TYPE_META: Record<string, Meta> = {
  STANDARD: { label: "Standard", tone: "neutral" },
  NORMAL: { label: "Normal", tone: "info" },
  EMERGENCY: { label: "Emergency", tone: "danger" },
};

export const CHANGE_STATUSES = [
  "DRAFT",
  "APPROVAL",
  "APPROVED",
  "SCHEDULED",
  "IN_PROGRESS",
  "REVIEW",
  "CLOSED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
] as const;
export const CHANGE_STATUS_META: Record<string, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: FileEdit },
  APPROVAL: { label: "In Approval", tone: "warning", icon: Clock },
  APPROVED: { label: "Approved", tone: "success", icon: ThumbsUp },
  SCHEDULED: { label: "Scheduled", tone: "indigo", icon: CalendarClock },
  IN_PROGRESS: { label: "In Progress", tone: "purple", icon: PlayCircle },
  REVIEW: { label: "Review", tone: "warning", icon: Search },
  CLOSED: { label: "Closed", tone: "success", icon: CircleCheck },
  REJECTED: { label: "Rejected", tone: "danger", icon: XCircle },
  FAILED: { label: "Failed", tone: "danger", icon: TriangleAlert },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: CircleSlash },
};

// Result of an implemented Change, recorded at review/closure (Change.outcome).
export const CHANGE_OUTCOMES = [
  "SUCCESSFUL",
  "SUCCESSFUL_WITH_ISSUES",
  "FAILED",
  "ROLLED_BACK",
] as const;
export const CHANGE_OUTCOME_META: Record<string, Meta> = {
  SUCCESSFUL: { label: "Successful", tone: "success", icon: CheckCircle2 },
  SUCCESSFUL_WITH_ISSUES: { label: "Successful with issues", tone: "warning", icon: TriangleAlert },
  FAILED: { label: "Failed", tone: "danger", icon: XCircle },
  ROLLED_BACK: { label: "Rolled back", tone: "purple", icon: Undo2 },
};

export const RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export const RISK_META: Record<string, Meta> = LEVEL_META;

// CANCELLED = withdrawn before a decision (the request's ticket was cancelled).
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const APPROVAL_META: Record<string, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

// How a Change's CAB approvals resolve (see Change.approvalRule / approvalThreshold).
export const CAB_APPROVAL_RULES = ["UNANIMOUS", "QUORUM", "PERCENT"] as const;
export const CAB_APPROVAL_RULE_META: Record<string, Meta> = {
  UNANIMOUS: { label: "Unanimous", tone: "indigo" },
  QUORUM: { label: "Quorum (N approvers)", tone: "purple" },
  PERCENT: { label: "Percentage", tone: "info" },
};

// Entities that support generic, ad-hoc approvals (see the Approval model).
export const APPROVAL_ENTITY_TYPES = ["TICKET", "PROBLEM", "CHANGE", "SERVICE"] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITY_TYPES)[number];
export const APPROVAL_ENTITY_META: Record<ApprovalEntityType, { label: string; path: string }> = {
  TICKET: { label: "Ticket", path: "/tickets" },
  PROBLEM: { label: "Problem", path: "/problems" },
  CHANGE: { label: "Change", path: "/changes" },
  SERVICE: { label: "Service", path: "/services" },
};

// Entities a knowledge article can be linked to (see the ArticleLink model).
export const ARTICLE_LINK_ENTITY_TYPES = ["TICKET", "PROBLEM", "CHANGE"] as const;
export type ArticleLinkEntityType = (typeof ARTICLE_LINK_ENTITY_TYPES)[number];

// ---- Service --------------------------------------------------------------
export const SERVICE_STATUSES = [
  "OPERATIONAL",
  "DEGRADED",
  "OUTAGE",
  "MAINTENANCE",
  "RETIRED",
] as const;
export const SERVICE_STATUS_META: Record<string, Meta> = {
  OPERATIONAL: { label: "Operational", tone: "success", icon: CheckCircle2 },
  DEGRADED: { label: "Degraded", tone: "warning", icon: TriangleAlert },
  OUTAGE: { label: "Outage", tone: "danger", icon: XCircle },
  MAINTENANCE: { label: "Maintenance", tone: "info", icon: Wrench },
  RETIRED: { label: "Retired", tone: "neutral", icon: CircleSlash },
};

export const CRITICALITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const CRITICALITY_META: Record<string, Meta> = PRIORITY_META;

// ---- Auto-assignment ------------------------------------------------------
export const AUTO_ASSIGN_STRATEGIES = ["OFF", "ROUND_ROBIN", "LEAST_BUSY"] as const;
export const AUTO_ASSIGN_META: Record<string, Meta> = {
  OFF: { label: "Off", tone: "neutral" },
  ROUND_ROBIN: { label: "Round-robin", tone: "indigo" },
  LEAST_BUSY: { label: "Least busy", tone: "purple" },
};

// ---- Group ----------------------------------------------------------------
export const GROUP_TYPES = ["TEAM", "DEPARTMENT", "VENDOR"] as const;
export const GROUP_TYPE_META: Record<string, Meta> = {
  TEAM: { label: "Team", tone: "indigo" },
  DEPARTMENT: { label: "Department", tone: "purple" },
  VENDOR: { label: "Vendor", tone: "info" },
};

export const GROUP_MEMBER_ROLES = ["MEMBER", "LEAD"] as const;
export const GROUP_MEMBER_ROLE_META: Record<string, Meta> = {
  MEMBER: { label: "Member", tone: "neutral" },
  LEAD: { label: "Lead", tone: "indigo" },
};

// ---- Asset ----------------------------------------------------------------
export const ASSET_TYPES = [
  "SERVER",
  "WORKSTATION",
  "LAPTOP",
  "NETWORK",
  "SOFTWARE",
  "MOBILE",
  "PRINTER",
  "VM",
  "CLOUD",
  "SERVICE",
  "MONITOR",
  "PHONE",
] as const;
export const ASSET_TYPE_META: Record<string, Meta> = {
  SERVER: { label: "Server", tone: "indigo" },
  WORKSTATION: { label: "Workstation", tone: "info" },
  LAPTOP: { label: "Laptop", tone: "info" },
  NETWORK: { label: "Network", tone: "purple" },
  SOFTWARE: { label: "Software", tone: "neutral" },
  MOBILE: { label: "Mobile", tone: "success" },
  PRINTER: { label: "Printer", tone: "neutral" },
  VM: { label: "Virtual Machine", tone: "indigo" },
  CLOUD: { label: "Cloud", tone: "info" },
  SERVICE: { label: "Service", tone: "purple" },
  MONITOR: { label: "Monitor", tone: "neutral" },
  PHONE: { label: "Phone", tone: "success" },
};

export const ASSET_STATUSES = [
  "IN_USE",
  "IN_STOCK",
  "MAINTENANCE",
  "RETIRED",
  "DISPOSED",
] as const;
export const ASSET_STATUS_META: Record<string, Meta> = {
  IN_USE: { label: "In Use", tone: "success" },
  IN_STOCK: { label: "In Stock", tone: "info" },
  MAINTENANCE: { label: "Maintenance", tone: "warning" },
  RETIRED: { label: "Retired", tone: "neutral" },
  DISPOSED: { label: "Disposed", tone: "danger" },
};

export const ASSET_RELATION_TYPES = [
  "DEPENDS_ON",
  "CONNECTS_TO",
  "RUNS_ON",
  "HOSTS",
  "PART_OF",
  "BACKS_UP",
] as const;
export const ASSET_RELATION_META: Record<string, Meta> = {
  DEPENDS_ON: { label: "Depends on", tone: "warning" },
  CONNECTS_TO: { label: "Connects to", tone: "info" },
  RUNS_ON: { label: "Runs on", tone: "indigo" },
  HOSTS: { label: "Hosts", tone: "purple" },
  PART_OF: { label: "Part of", tone: "neutral" },
  BACKS_UP: { label: "Backs up", tone: "success" },
};

// ---- Sync -----------------------------------------------------------------
export const SYNC_TYPES = [
  "LDAP",
  "ACTIVE_DIRECTORY",
  "AZURE_AD",
  "INTUNE",
  "CSV",
  "SNOW",
  "REST_API",
  "GLPI",
] as const;
export const SYNC_TYPE_META: Record<string, Meta> = {
  LDAP: { label: "LDAP", tone: "indigo" },
  ACTIVE_DIRECTORY: { label: "Active Directory", tone: "info" },
  AZURE_AD: { label: "Azure AD / Entra", tone: "info" },
  INTUNE: { label: "Microsoft Intune", tone: "purple" },
  CSV: { label: "CSV Import", tone: "neutral" },
  SNOW: { label: "ServiceNow", tone: "success" },
  REST_API: { label: "REST API", tone: "neutral" },
  GLPI: { label: "GLPI", tone: "warning" },
};

export const SYNC_DIRECTIONS = ["IMPORT", "EXPORT", "BIDIRECTIONAL"] as const;
export const SYNC_SCOPES = ["USERS", "ASSETS", "TICKETS", "ALL"] as const;
export const SYNC_RUN_STATUSES = [
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "PARTIAL",
] as const;
export const SYNC_RUN_STATUS_META: Record<string, Meta> = {
  RUNNING: { label: "Running", tone: "info", icon: PlayCircle },
  SUCCESS: { label: "Success", tone: "success", icon: CheckCircle2 },
  FAILED: { label: "Failed", tone: "danger", icon: XCircle },
  PARTIAL: { label: "Partial", tone: "warning", icon: TriangleAlert },
};

// VIP flag (for important requesters)
export const VIP_META: Meta = { label: "VIP", tone: "warning", icon: Crown };

// ---- SLA clock state ------------------------------------------------------
export const SLA_STATES = ["ON_TRACK", "AT_RISK", "BREACHED", "MET", "PAUSED", "NONE"] as const;
export const SLA_STATE_META: Record<string, Meta> = {
  ON_TRACK: { label: "On track", tone: "success", icon: CheckCircle2 },
  AT_RISK: { label: "At risk", tone: "warning", icon: TriangleAlert },
  BREACHED: { label: "Breached", tone: "danger", icon: Flame },
  MET: { label: "Met", tone: "success", icon: CircleCheck },
  PAUSED: { label: "Paused", tone: "neutral", icon: PauseCircle },
  NONE: { label: "No SLA", tone: "neutral" },
};

// ---- SLA escalation -------------------------------------------------------
// Actions an EscalationStep can run as an SLA clock elapses.
// The *_ONCALL actions target whoever is on call for the ticket's group
// (currentOnCall in lib/oncall.ts) instead of a fixed user/group.
export const ESCALATION_ACTIONS = [
  "NOTIFY",
  "REASSIGN",
  "BUMP_PRIORITY",
  "NOTIFY_ONCALL",
  "REASSIGN_ONCALL",
] as const;
export const ESCALATION_ACTION_META: Record<string, Meta> = {
  NOTIFY: { label: "Notify", tone: "info", icon: Send },
  REASSIGN: { label: "Reassign", tone: "purple", icon: ArrowUp },
  BUMP_PRIORITY: { label: "Bump priority", tone: "warning", icon: Flame },
  NOTIFY_ONCALL: { label: "Notify on-call", tone: "info", icon: PhoneCall },
  REASSIGN_ONCALL: { label: "Reassign to on-call", tone: "purple", icon: PhoneCall },
};

// ---- CSAT survey ----------------------------------------------------------
// Rating scale for a post-resolution SurveyResponse (inclusive).
export const SURVEY_RATING_MIN = 1;
export const SURVEY_RATING_MAX = 5;

// ---- Knowledge base -------------------------------------------------------
export const ARTICLE_STATUSES = [
  "DRAFT",
  "REVIEW",
  "PUBLISHED",
  "RETIRED",
] as const;
export const ARTICLE_STATUS_META: Record<string, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: FileEdit },
  REVIEW: { label: "In Review", tone: "warning", icon: Search },
  PUBLISHED: { label: "Published", tone: "success", icon: CircleCheck },
  RETIRED: { label: "Retired", tone: "neutral", icon: CircleSlash },
};

/** Remote MCP transports Sable supports (no local stdio: nothing runs on the host). */
export const AI_MCP_TRANSPORTS = ["http", "sse"] as const;
export type AiMcpTransport = (typeof AI_MCP_TRANSPORTS)[number];

/**
 * How Sable may use a remote MCP server's tools:
 *  - READ_ONLY: only tools annotated readOnlyHint run; everything else is blocked
 *  - APPROVAL:  read-only tools run; others become approve-first proposals
 *  - TRUSTED:   every tool runs directly (still shown live in the chat)
 */
export const AI_MCP_MODES = ["READ_ONLY", "APPROVAL", "TRUSTED"] as const;
export type AiMcpMode = (typeof AI_MCP_MODES)[number];
export const AI_MCP_MODE_META: Record<AiMcpMode, { label: string; description: string }> = {
  READ_ONLY: { label: "Read only", description: "Only read-only tools; anything that changes data is blocked." },
  APPROVAL: { label: "With approval", description: "Read-only tools run; other tool calls need an Approve click." },
  TRUSTED: { label: "Trusted", description: "All tools run directly." },
};

export const ARTICLE_VISIBILITIES = ["INTERNAL", "PUBLIC"] as const;
export const ARTICLE_VISIBILITY_META: Record<string, Meta> = {
  INTERNAL: { label: "Internal", tone: "warning", icon: Lock },
  PUBLIC: { label: "Public", tone: "info", icon: Globe },
};

// ---- Location ----
export const LOCATION_TYPES = [
  "SITE",
  "BUILDING",
  "FLOOR",
  "ROOM",
  "DATACENTER",
  "RACK",
] as const;
export const LOCATION_TYPE_META: Record<string, Meta> = {
  SITE: { label: "Site", tone: "indigo", icon: MapPin },
  BUILDING: { label: "Building", tone: "info", icon: Building2 },
  FLOOR: { label: "Floor", tone: "purple", icon: Layers },
  ROOM: { label: "Room", tone: "neutral", icon: DoorClosed },
  DATACENTER: { label: "Datacenter", tone: "success", icon: Server },
  RACK: { label: "Rack", tone: "warning", icon: Rows3 },
};

// ---- On-call --------------------------------------------------------------
// Rotation cadence of an OnCallSchedule. `hours` is the shift length; CUSTOM
// uses OnCallSchedule.customIntervalHours instead.
export const ONCALL_ROTATION_TYPES = ["DAILY", "WEEKLY", "CUSTOM"] as const;
export type OnCallRotationType = (typeof ONCALL_ROTATION_TYPES)[number];
export const ONCALL_ROTATION_META: Record<OnCallRotationType, Meta & { hours: number | null }> = {
  DAILY: { label: "Daily", tone: "info", hours: 24 },
  WEEKLY: { label: "Weekly", tone: "indigo", hours: 168 },
  CUSTOM: { label: "Custom", tone: "purple", hours: null },
};

// ---- Recurring tickets ----------------------------------------------------
export const RECURRENCE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
/** `unit` names one step in the "Every 3 months" summary. */
export const RECURRENCE_FREQUENCY_META: Record<RecurrenceFrequency, Meta & { unit: string }> = {
  DAILY: { label: "Daily", tone: "info", unit: "day" },
  WEEKLY: { label: "Weekly", tone: "indigo", unit: "week" },
  MONTHLY: { label: "Monthly", tone: "purple", unit: "month" },
  YEARLY: { label: "Yearly", tone: "success", unit: "year" },
};

// ---- Status page ----------------------------------------------------------
export const STATUS_INCIDENT_STATES = [
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
] as const;
export const STATUS_INCIDENT_STATE_META: Record<string, Meta> = {
  INVESTIGATING: { label: "Investigating", tone: "danger", icon: Search },
  IDENTIFIED: { label: "Identified", tone: "warning", icon: Target },
  MONITORING: { label: "Monitoring", tone: "info", icon: Eye },
  RESOLVED: { label: "Resolved", tone: "success", icon: CheckCircle2 },
};
/** States in which a status incident is still active (shown in banners). */
export const ACTIVE_STATUS_INCIDENT_STATES = ["INVESTIGATING", "IDENTIFIED", "MONITORING"] as const;

export const STATUS_INCIDENT_IMPACTS = ["NONE", "MINOR", "MAJOR", "CRITICAL"] as const;
export const STATUS_INCIDENT_IMPACT_META: Record<string, Meta> = {
  NONE: { label: "No impact", tone: "neutral" },
  MINOR: { label: "Minor", tone: "warning", icon: TriangleAlert },
  MAJOR: { label: "Major", tone: "danger", icon: XCircle },
  CRITICAL: { label: "Critical", tone: "danger", icon: Flame },
};

// ---- Maintenance windows & self-update --------------------------------------
export const MAINTENANCE_KINDS = ["GENERAL", "UPDATE"] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];
export const MAINTENANCE_KIND_META: Record<MaintenanceKind, Meta> = {
  GENERAL: { label: "Maintenance", tone: "info" },
  UPDATE: { label: "Update", tone: "purple" },
};

export const MAINTENANCE_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "ROLLED_BACK",
  "CANCELLED",
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export const MAINTENANCE_STATUS_META: Record<MaintenanceStatus, Meta> = {
  SCHEDULED: { label: "Scheduled", tone: "info", icon: CalendarClock },
  IN_PROGRESS: { label: "In progress", tone: "warning", icon: PlayCircle },
  COMPLETED: { label: "Completed", tone: "success", icon: CheckCircle2 },
  FAILED: { label: "Failed", tone: "danger", icon: XCircle },
  ROLLED_BACK: { label: "Rolled back", tone: "warning", icon: Undo2 },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: CircleSlash },
};

/** The updater sidecar's steps (lib/maintenance-rules.ts UPDATER_STATES), shown in the window log. */
export const UPDATER_STATE_META: Record<UpdaterState, Meta> = {
  PENDING: { label: "Pending", tone: "neutral" },
  PULLING: { label: "Pulling image", tone: "info" },
  BACKING_UP: { label: "Backing up", tone: "info" },
  SWITCHING: { label: "Switching", tone: "warning" },
  HEALTH_CHECK: { label: "Health check", tone: "warning" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  ROLLED_BACK: { label: "Rolled back", tone: "warning" },
};

// ---- Built-in backup (lib/backup.ts) ----------------------------------------
export const BACKUP_RUN_STATUSES = ["RUNNING", "SUCCESS", "FAILED"] as const;
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number];
export const BACKUP_RUN_STATUS_META: Record<BackupRunStatus, Meta> = {
  RUNNING: { label: "Running", tone: "info", icon: PlayCircle },
  SUCCESS: { label: "Verified", tone: "success", icon: CheckCircle2 },
  FAILED: { label: "Failed", tone: "danger", icon: XCircle },
};

export const BACKUP_TRIGGERS = ["SCHEDULE", "MANUAL", "CLI"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];
export const BACKUP_TRIGGER_META: Record<BackupTrigger, Meta> = {
  SCHEDULE: { label: "Scheduled", tone: "neutral", icon: CalendarClock },
  MANUAL: { label: "Manual", tone: "indigo" },
  CLI: { label: "Command line", tone: "neutral" },
};

// ---- Releases & change templates -------------------------------------------
export const RELEASE_STATUSES = [
  "PLANNING",
  "READY",
  "IN_PROGRESS",
  "DEPLOYED",
  "CANCELLED",
] as const;
export const RELEASE_STATUS_META: Record<string, Meta> = {
  PLANNING: { label: "Planning", tone: "neutral", icon: FileEdit },
  READY: { label: "Ready", tone: "success", icon: ThumbsUp },
  IN_PROGRESS: { label: "In Progress", tone: "purple", icon: PlayCircle },
  DEPLOYED: { label: "Deployed", tone: "success", icon: Rocket },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: CircleSlash },
};

/** Change types a ChangeTemplate may produce (EMERGENCY is never templated). */
export const CHANGE_TEMPLATE_TYPES = ["STANDARD", "NORMAL"] as const;

// ---- Contracts & licenses -------------------------------------------------
export const CONTRACT_TYPES = [
  "SUPPORT",
  "MAINTENANCE",
  "LEASE",
  "SUBSCRIPTION",
  "WARRANTY",
  "SERVICE",
  "OTHER",
] as const;
export const CONTRACT_TYPE_META: Record<string, Meta> = {
  SUPPORT: { label: "Support", tone: "info" },
  MAINTENANCE: { label: "Maintenance", tone: "indigo" },
  LEASE: { label: "Lease", tone: "purple" },
  SUBSCRIPTION: { label: "Subscription", tone: "info" },
  WARRANTY: { label: "Warranty", tone: "success" },
  SERVICE: { label: "Service", tone: "indigo" },
  OTHER: { label: "Other", tone: "neutral" },
};

export const CONTRACT_STATUSES = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"] as const;
export const CONTRACT_STATUS_META: Record<string, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: FileEdit },
  ACTIVE: { label: "Active", tone: "success", icon: CheckCircle2 },
  EXPIRED: { label: "Expired", tone: "warning", icon: CalendarX2 },
  TERMINATED: { label: "Terminated", tone: "neutral", icon: Ban },
};

export const LICENSE_TYPES = [
  "PER_USER",
  "PER_DEVICE",
  "SITE",
  "CONCURRENT",
  "SUBSCRIPTION",
] as const;
export const LICENSE_TYPE_META: Record<string, Meta> = {
  PER_USER: { label: "Per user", tone: "info" },
  PER_DEVICE: { label: "Per device", tone: "indigo" },
  SITE: { label: "Site", tone: "purple" },
  CONCURRENT: { label: "Concurrent", tone: "warning" },
  SUBSCRIPTION: { label: "Subscription", tone: "info" },
};

// ---- Sable insights -------------------------------------------------------
export const AI_INSIGHT_KINDS = ["CLUSTER", "KB_GAP"] as const;
export const AI_INSIGHT_KIND_META: Record<string, Meta> = {
  CLUSTER: { label: "Incident cluster", tone: "danger", icon: Boxes },
  KB_GAP: { label: "Knowledge gap", tone: "info", icon: BookOpen },
};

export const AI_INSIGHT_STATUSES = ["OPEN", "ACTIONED", "DISMISSED"] as const;
export const AI_INSIGHT_STATUS_META: Record<string, Meta> = {
  OPEN: { label: "Open", tone: "warning", icon: CircleDot },
  ACTIONED: { label: "Actioned", tone: "success", icon: CheckCircle2 },
  DISMISSED: { label: "Dismissed", tone: "neutral", icon: CircleSlash },
};

// Generic fallback lookup
export function metaFor(
  map: Record<string, Meta>,
  key: string | null | undefined,
): Meta {
  if (!key) return { label: "—", tone: "neutral" };
  return map[key] ?? { label: key, tone: "neutral" };
}

// Human ref numbers
export const PREFIX = {
  ticket: "INC",
  request: "REQ",
  problem: "PRB",
  change: "CHG",
} as const;

/** The fixed ref prefix a ticket gets at creation, derived from its initial type. */
export function prefixForType(type: string | null | undefined) {
  return type === "REQUEST" ? "REQ" : "INC";
}

/**
 * Human ref for a ticket. The second arg is the STORED `ticket.prefix` (preferred —
 * stable across type changes). For backward-compat it also accepts a raw type
 * ("INCIDENT"/"REQUEST") and maps it, so legacy callers keep working.
 */
export function ticketRef(id: number, prefixOrType = "INC") {
  const prefix =
    prefixOrType === "INCIDENT"
      ? "INC"
      : prefixOrType === "REQUEST"
        ? "REQ"
        : prefixOrType || "INC";
  return `${prefix}-${String(id).padStart(4, "0")}`;
}
/**
 * Reverse of {@link ticketRef}: pull a ticket ref out of arbitrary text (e.g. an
 * email subject `Re: [INC-0042] …`). Tolerates leading zeros and any case.
 * Returns the numeric id + prefix, or null if none is present.
 */
export function parseTicketRef(input: string): { id: number; prefix: string } | null {
  const m = (input ?? "").match(/\b(INC|REQ)-0*(\d+)\b/i);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), id: Number(m[2]) };
}

export function problemRef(id: number) {
  return `PRB-${String(id).padStart(4, "0")}`;
}
export function changeRef(id: number) {
  return `CHG-${String(id).padStart(4, "0")}`;
}
export function releaseRef(id: number) {
  return `REL-${String(id).padStart(4, "0")}`;
}

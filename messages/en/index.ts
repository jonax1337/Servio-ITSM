// The English catalog is the source of truth: every key used in the UI is defined here.
// One file per namespace; add a namespace by creating messages/en/<ns>.ts + messages/de/<ns>.ts
// and listing it in both index files.
import common from "./common";
import nav from "./nav";
import shell from "./shell";
import account from "./account";
import components from "./components";
import dashboard from "./dashboard";
import tickets from "./tickets";
import problems from "./problems";
import changes from "./changes";
import releases from "./releases";
import approvals from "./approvals";
import assets from "./assets";
import contracts from "./contracts";
import locations from "./locations";
import categories from "./categories";
import knowledge from "./knowledge";
import services from "./services";
import catalog from "./catalog";
import status from "./status";
import oncall from "./oncall";
import maintenance from "./maintenance";
import insights from "./insights";
import automations from "./automations";
import settings from "./settings";
import syncs from "./syncs";
import audit from "./audit";
import people from "./people";
import groups from "./groups";
import portal from "./portal";
import auth from "./auth";
import survey from "./survey";
import assistant from "./assistant";
import errors from "./errors";

export const en = {
  common,
  nav,
  shell,
  account,
  components,
  dashboard,
  tickets,
  problems,
  changes,
  releases,
  approvals,
  assets,
  contracts,
  locations,
  categories,
  knowledge,
  services,
  catalog,
  status,
  oncall,
  maintenance,
  insights,
  automations,
  settings,
  syncs,
  audit,
  people,
  groups,
  portal,
  auth,
  survey,
  assistant,
  errors,
};

export type Messages = typeof en;

import common from "./common";
import tickets from "./tickets";
import changes from "./changes";
import cmdb from "./cmdb";
import operations from "./operations";
import admin from "./admin";
import portal from "./portal";
import assistant from "./assistant";
import dashboard from "./dashboard";
import type { ServerMessages } from "../../types";

export { patterns } from "./patterns";

export const messages: ServerMessages = {
  ...common,
  ...tickets,
  ...changes,
  ...cmdb,
  ...operations,
  ...admin,
  ...portal,
  ...assistant,
  ...dashboard,
};

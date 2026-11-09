import type { SyncSource } from "@prisma/client";

/**
 * The connector contract every sync integration implements. `runSync`
 * (lib/actions/syncs.ts) looks a connector up by `SyncSource.type` in the
 * registry (lib/connectors/index.ts) and calls `run()`; the scheduler will do
 * the same for cron-triggered runs. Keep connectors side-effect-free until
 * `run()` is called so `test()` can validate config cheaply.
 */

export type SyncRunStatus = "SUCCESS" | "PARTIAL" | "FAILED";

export type SyncResult = {
  status: SyncRunStatus;
  created: number;
  updated: number;
  failed: number;
  /** Human-readable, newline-separated summary stored on SyncRun.log. */
  log: string;
};

export type ConnectorRunContext = {
  trigger: "MANUAL" | "SCHEDULED";
};

export type ConnectorTestResult = { ok: boolean; message: string };

export interface Connector {
  /** Cheap connectivity/credentials check for the "Test connection" button. */
  test(source: SyncSource): Promise<ConnectorTestResult>;
  /** Perform the actual import/export. Should never throw — map failures into
   *  a FAILED result with a descriptive log so the run row is always written. */
  run(source: SyncSource, ctx: ConnectorRunContext): Promise<SyncResult>;
}

/** Accumulates log lines during a run and reports counts. */
export class SyncLog {
  private lines: string[] = [];
  created = 0;
  updated = 0;
  failed = 0;
  /** Records that matched what is stored; not written, not part of `updated`. */
  unchanged = 0;

  line(msg: string): void {
    this.lines.push(msg);
  }

  toString(): string {
    return this.lines.join("\n");
  }

  /** Derive a run status from the counters. */
  status(): SyncRunStatus {
    if (this.failed > 0 && this.created === 0 && this.updated === 0 && this.unchanged === 0)
      return "FAILED";
    return this.failed > 0 ? "PARTIAL" : "SUCCESS";
  }

  result(): SyncResult {
    return {
      status: this.status(),
      created: this.created,
      updated: this.updated,
      failed: this.failed,
      log: this.toString(),
    };
  }
}

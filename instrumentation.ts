// Next.js runs `register()` once when a server instance boots (before it serves
// requests). We use it to start the in-process scheduler (inbound mail poll,
// sync runner, SLA escalation) and to stop it cleanly on shutdown. Node runtime
// only — the Edge runtime has no sockets.
//
// The scheduler is single-instance by design: set SCHEDULER_ENABLED=false on any
// replica that must not fire background ticks (see docs/deployment.md).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler, stopScheduler } = await import("./lib/scheduler");
  await startScheduler();

  // Graceful shutdown: clear the cron timers so ticks never fire mid-teardown.
  // Guarded via globalThis so `next dev` HMR reloads don't stack listeners.
  const g = globalThis as unknown as { __servioSignalsWired?: boolean };
  if (!g.__servioSignalsWired) {
    g.__servioSignalsWired = true;
    process.on("SIGTERM", () => stopScheduler());
    process.on("SIGINT", () => stopScheduler());
  }
}

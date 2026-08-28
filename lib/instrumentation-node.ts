// Node-only half of instrumentation.ts, split into its own module per the
// Next.js instrumentation docs ("Specifying the runtime": use a conditional
// require() to a dedicated file rather than inlining Node APIs directly in
// instrumentation.ts). Turbopack still type-checks instrumentation.ts against
// both the Node and Edge runtime bundles, so any Node-only API referenced
// there directly (e.g. `process.on`) produces a spurious
// "not supported in the Edge Runtime" warning even though the call is dead
// code on the Edge branch. Moving the Node-only body here — loaded via
// `require()` only when `NEXT_RUNTIME === "nodejs"` — keeps that code out of
// the file Turbopack cross-checks against the Edge runtime.
export async function registerNode(): Promise<void> {
  const { startScheduler, stopScheduler } = await import("./scheduler");
  await startScheduler();

  // Guarded via globalThis so `next dev` HMR reloads don't stack listeners.
  const g = globalThis as unknown as { __servioSignalsWired?: boolean };
  if (!g.__servioSignalsWired) {
    g.__servioSignalsWired = true;
    process.on("SIGTERM", () => stopScheduler());
    process.on("SIGINT", () => stopScheduler());
  }
}

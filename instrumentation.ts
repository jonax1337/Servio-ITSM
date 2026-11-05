// Next.js runs `register()` once when a server instance boots (before it serves
// requests). We use it to start the in-process scheduler (inbound mail poll,
// sync runner, SLA escalation) and to stop it cleanly on shutdown. Node runtime
// only — the Edge runtime has no sockets.
//
// The scheduler is single-instance by design: set SCHEDULER_ENABLED=false on any
// replica that must not fire background ticks (see docs/deployment.md).
//
// The Node-only body (which calls `process.on`) lives in
// `lib/instrumentation-node.ts` and is loaded via a dynamic `import()` gated
// on NEXT_RUNTIME, per the Next.js instrumentation docs' "Specifying the
// runtime" guidance — keeping Node-only APIs out of this file avoids a
// spurious "Node.js API ... not supported in the Edge Runtime" build warning
// that Turbopack otherwise emits when cross-checking this file against the
// Edge runtime bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("./lib/instrumentation-node");
  await registerNode();
}

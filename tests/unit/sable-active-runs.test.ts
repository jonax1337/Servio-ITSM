import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { beginRun, hasRun, stopRun, subscribeRun } from "@/lib/sable-active-runs";

/** A source the test feeds by hand, so it controls exactly when chunks arrive. */
function manualSource() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  const stream = new ReadableStream<UIMessageChunk>({ start: (c) => void (controller = c) });
  return {
    stream,
    push: (delta: string) => controller.enqueue({ type: "text-delta", id: "t", delta }),
    end: () => controller.close(),
    fail: () => controller.error(new Error("boom")),
  };
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

const deltas = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((c) => (c.type === "text-delta" ? [c.delta] : c.type === "error" ? ["<error>"] : []));

const tick = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;
const newConversation = () => `conv-${++seq}`;

/** Begin a run that must be accepted. */
function begin(conv: string, userId = "u1", abort = new AbortController()) {
  const run = beginRun(conv, userId, abort);
  if (!run) throw new Error("expected the run to be accepted");
  return run;
}

describe("sable active runs", () => {
  it("replays what was streamed so far to a client that rejoins, then the rest live", async () => {
    const conv = newConversation();
    const src = manualSource();
    begin(conv).attach(src.stream);
    src.push("a");
    src.push("b");
    await tick();

    const rejoined = subscribeRun(conv, "u1")!;
    src.push("c");
    src.end();
    expect(deltas(await readAll(rejoined))).toEqual(["a", "b", "c"]);
  });

  it("keeps running when the starting client goes away", async () => {
    const conv = newConversation();
    const src = manualSource();
    const abort = new AbortController();
    await begin(conv, "u1", abort).attach(src.stream).cancel();
    src.push("still here");
    src.end();
    await tick();

    expect(abort.signal.aborted).toBe(false);
    expect(deltas(await readAll(subscribeRun(conv, "u1")!))).toEqual(["still here"]);
  });

  it("can be joined and stopped while the turn is still being prepared", async () => {
    const conv = newConversation();
    const abort = new AbortController();
    const pending = begin(conv, "u1", abort);
    const early = subscribeRun(conv, "u1")!;
    expect(hasRun(conv)).toBe(true);

    const src = manualSource();
    pending.attach(src.stream);
    src.push("answer");
    src.end();
    expect(deltas(await readAll(early))).toEqual(["answer"]);

    expect(stopRun(newConversation(), "u1")).toBe(false);
    const stoppable = newConversation();
    const stopAbort = new AbortController();
    begin(stoppable, "u1", stopAbort);
    expect(stopRun(stoppable, "u1")).toBe(true);
    expect(stopAbort.signal.aborted).toBe(true);
  });

  it("refuses a second run while one is still answering", () => {
    const conv = newConversation();
    begin(conv).attach(manualSource().stream);
    expect(beginRun(conv, "u1", new AbortController())).toBeNull();
  });

  it("replaces a finished run, so its answer is never replayed under a new question", async () => {
    const conv = newConversation();
    const old = manualSource();
    begin(conv).attach(old.stream);
    old.push("old answer");
    old.end();
    await tick();

    const next = manualSource();
    begin(conv).attach(next.stream);
    const rejoined = subscribeRun(conv, "u1")!;
    next.push("new answer");
    next.end();
    expect(deltas(await readAll(rejoined))).toEqual(["new answer"]);
  });

  it("is gone once a turn that could not start is discarded", () => {
    const conv = newConversation();
    begin(conv).discard();
    expect(hasRun(conv)).toBe(false);
    expect(beginRun(conv, "u1", new AbortController())).not.toBeNull();
  });

  it("ends its subscribers with an error when the answer breaks off", async () => {
    const conv = newConversation();
    const src = manualSource();
    const sub = begin(conv).attach(src.stream);
    src.push("partial");
    src.fail();
    expect(deltas(await readAll(sub))).toEqual(["partial", "<error>"]);
  });

  it("is invisible and unstoppable for another user", () => {
    const conv = newConversation();
    const abort = new AbortController();
    begin(conv, "u1", abort).attach(manualSource().stream);

    expect(subscribeRun(conv, "u2")).toBeNull();
    expect(stopRun(conv, "u2")).toBe(false);
    expect(abort.signal.aborted).toBe(false);
  });

  it("has nothing to rejoin in a conversation without a run", () => {
    expect(subscribeRun(newConversation(), "u1")).toBeNull();
  });
});

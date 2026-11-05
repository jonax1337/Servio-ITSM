import type { UIMessageChunk } from "ai";

/**
 * Sable's in-flight answers, decoupled from the HTTP request that started them.
 *
 * A chat turn keeps running when its client goes away (another chat opened, the
 * window closed, a reload): the agent run is pumped into a buffer here, and any
 * client of the same user can subscribe again, getting everything streamed so
 * far and then the rest live. Only an explicit stop cancels a run.
 *
 * A run is registered (`beginRun`) BEFORE the user's message is saved and gets its
 * stream later (`attach`): whoever sees the saved question can always rejoin or
 * stop its answer, even while the turn is still being prepared.
 *
 * In-process on purpose: Servio runs as one self-hosted Node process (like the
 * mail scheduler), so no Redis. Kept on globalThis so every route bundle shares
 * one registry.
 */

type Chunk = UIMessageChunk;

type Run = {
  userId: string;
  chunks: Chunk[];
  listeners: Set<(chunk: Chunk | null) => void>;
  done: boolean;
  abort: AbortController;
};

/** How long a finished run stays replayable, for a client that read the transcript just before it was saved. */
const FINISHED_RETENTION_MS = 60_000;
/** A run nobody stops still ends eventually, so a hung agent cannot hold its slot forever. */
const MAX_RUN_MS = 15 * 60_000;

const registry = globalThis as typeof globalThis & { __sableActiveRuns?: Map<string, Run> };
const runs = (registry.__sableActiveRuns ??= new Map<string, Run>());

/** A registered run waiting for its stream (see {@link beginRun}). */
export type PendingRun = {
  /** Start pumping the answer into the run; returns the starting client's subscription. */
  attach(source: ReadableStream<Chunk>): ReadableStream<Chunk>;
  /** The turn could not start: drop the run (its subscribers see an empty answer). */
  discard(): void;
};

/**
 * Register a new run for the conversation, or null while the previous one is still
 * running (one answer at a time; the client should rejoin that one). A finished run
 * kept for replay is replaced, so it can never be replayed under the new question.
 */
export function beginRun(conversationId: string, userId: string, abort: AbortController): PendingRun | null {
  const previous = runs.get(conversationId);
  if (previous && !previous.done) return null;
  const run: Run = { userId, chunks: [], listeners: new Set(), done: false, abort };
  runs.set(conversationId, run);
  const timeout = setTimeout(() => abort.abort(), MAX_RUN_MS);
  timeout.unref?.();
  return {
    attach(source) {
      const subscriber = subscription(run);
      void pump(conversationId, run, source).finally(() => clearTimeout(timeout));
      return subscriber;
    },
    discard() {
      clearTimeout(timeout);
      finish(run);
      if (runs.get(conversationId) === run) runs.delete(conversationId);
    },
  };
}

/** A replay-then-live stream of the user's run in this conversation, or null if there is none. */
export function subscribeRun(conversationId: string, userId: string): ReadableStream<Chunk> | null {
  const run = runs.get(conversationId);
  return run && run.userId === userId ? subscription(run) : null;
}

/** Whether the conversation has a run whose answer can still be joined or replayed. */
export function hasRun(conversationId: string): boolean {
  return runs.has(conversationId);
}

/** Cancel the user's running answer in this conversation. False when nothing of theirs is running. */
export function stopRun(conversationId: string, userId: string): boolean {
  const run = runs.get(conversationId);
  if (!run || run.userId !== userId || run.done) return false;
  run.abort.abort();
  return true;
}

async function pump(conversationId: string, run: Run, source: ReadableStream<Chunk>) {
  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      publish(run, value);
    }
  } catch (e) {
    console.error(`[sable] run in conversation ${conversationId} failed`, e);
    publish(run, { type: "error", errorText: "Sable's answer was interrupted." });
  } finally {
    finish(run);
    setTimeout(() => {
      if (runs.get(conversationId) === run) runs.delete(conversationId);
    }, FINISHED_RETENTION_MS).unref?.();
  }
}

/** Buffer a chunk and hand it to every subscriber; one broken subscriber never stops the others. */
function publish(run: Run, chunk: Chunk) {
  run.chunks.push(chunk);
  run.listeners.forEach((listen) => {
    try {
      listen(chunk);
    } catch {
      run.listeners.delete(listen);
    }
  });
}

function finish(run: Run) {
  run.done = true;
  run.listeners.forEach((listen) => {
    try {
      listen(null);
    } catch {
      /* already closed by its reader */
    }
  });
  run.listeners.clear();
}

/** Everything buffered so far, then live chunks until the run ends. Cancelling only detaches this reader. */
function subscription(run: Run): ReadableStream<Chunk> {
  let listener: ((chunk: Chunk | null) => void) | undefined;
  return new ReadableStream<Chunk>({
    start(controller) {
      run.chunks.forEach((chunk) => controller.enqueue(chunk));
      if (run.done) {
        controller.close();
        return;
      }
      listener = (chunk) => {
        if (chunk === null) controller.close();
        else controller.enqueue(chunk);
      };
      run.listeners.add(listener);
    },
    cancel() {
      if (listener) run.listeners.delete(listener);
    },
  });
}

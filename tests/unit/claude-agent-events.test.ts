import { describe, expect, it } from "vitest";
import {
  AgentTranscript,
  agentRunFailure,
  createAgentEventMapper,
  pipeAgentRun,
  TOOL_PREFIX,
  type AgentChunk,
} from "@/lib/claude-agent-events";

const streamEvent = (event: object) => ({ type: "stream_event", parent_tool_use_id: null, event });

/** One Claude Code step: thinking → text → a tool call with fragmented JSON input. */
const STEP_WITH_TOOL = [
  streamEvent({ type: "message_start" }),
  streamEvent({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
  streamEvent({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Need the ticket." } }),
  streamEvent({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
  streamEvent({ type: "content_block_stop", index: 0 }),
  streamEvent({ type: "content_block_start", index: 1, content_block: { type: "text" } }),
  streamEvent({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Looking it up." } }),
  streamEvent({ type: "content_block_stop", index: 1 }),
  streamEvent({
    type: "content_block_start",
    index: 2,
    content_block: { type: "tool_use", id: "toolu_1", name: `${TOOL_PREFIX}get_ticket` },
  }),
  streamEvent({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"id":' } }),
  streamEvent({ type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "42}" } }),
  streamEvent({ type: "content_block_stop", index: 2 }),
  streamEvent({ type: "message_stop" }),
];

const TOOL_RESULT = {
  type: "user",
  parent_tool_use_id: null,
  message: {
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: '{"ref":"INC-42"}' }] }],
  },
};

function mapAll(messages: unknown[]): AgentChunk[] {
  const mapper = createAgentEventMapper();
  return messages.flatMap((m) => mapper.map(m));
}

describe("createAgentEventMapper", () => {
  it("streams thinking, text and a tool call as live UI chunks in order", () => {
    const chunks = mapAll(STEP_WITH_TOOL);

    expect(chunks.map((c) => c.type)).toEqual([
      "start-step",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-available",
      "finish-step",
    ]);
  });

  it("strips the MCP prefix and assembles the fragmented tool input", () => {
    const chunks = mapAll(STEP_WITH_TOOL);

    expect(chunks).toContainEqual({ type: "tool-input-start", toolCallId: "toolu_1", toolName: "get_ticket" });
    expect(chunks).toContainEqual({
      type: "tool-input-available",
      toolCallId: "toolu_1",
      toolName: "get_ticket",
      input: { id: 42 },
    });
  });

  it("turns a tool_result into the parsed tool output", () => {
    expect(mapAll([...STEP_WITH_TOOL, TOOL_RESULT]).at(-1)).toEqual({
      type: "tool-output-available",
      toolCallId: "toolu_1",
      output: { ref: "INC-42" },
    });
  });

  it("reports an errored tool_result as a tool error", () => {
    const failed = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: true, content: "boom" }] },
    };

    expect(mapAll([...STEP_WITH_TOOL, failed]).at(-1)).toEqual({
      type: "tool-output-error",
      toolCallId: "toolu_1",
      errorText: "boom",
    });
  });

  it("keeps a non-JSON tool output as text", () => {
    const plain = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "plain words" }] },
    };

    expect(mapAll([...STEP_WITH_TOOL, plain]).at(-1)).toEqual({
      type: "tool-output-available",
      toolCallId: "toolu_1",
      output: "plain words",
    });
  });

  it("drops results for tool calls the UI never saw (they would abort the client stream)", () => {
    const hallucinated = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_unknown", is_error: true, content: "No such tool" }] },
    };

    expect(mapAll([...STEP_WITH_TOOL, hallucinated]).some((c) => c.type === "tool-output-error")).toBe(false);
  });

  it("ignores tools outside our MCP server and subagent traffic", () => {
    const chunks = mapAll([
      streamEvent({ type: "message_start" }),
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "x", name: "Bash" } }),
      streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
      streamEvent({ type: "content_block_stop", index: 0 }),
      { ...streamEvent({ type: "message_start" }), parent_tool_use_id: "toolu_9" },
    ]);

    expect(chunks).toEqual([{ type: "start-step" }]);
  });

  it("shows a skill being loaded as a use_skill step", () => {
    const chunks = mapAll([
      streamEvent({ type: "message_start" }),
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_s", name: "Skill" } }),
      streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"skill":"incident-triage"}' } }),
      streamEvent({ type: "content_block_stop", index: 0 }),
    ]);

    expect(chunks).toContainEqual({
      type: "tool-input-available",
      toolCallId: "toolu_s",
      toolName: "use_skill",
      input: { skill: "incident-triage" },
    });
  });

  it("gives blocks of different steps distinct ids", () => {
    const step = [
      streamEvent({ type: "message_start" }),
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
    ];
    const ids = mapAll([...step, ...step])
      .filter((c): c is Extract<AgentChunk, { type: "text-start" }> => c.type === "text-start")
      .map((c) => c.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe("AgentTranscript", () => {
  it("collects text per step, the tool calls with their outputs, and the thinking", () => {
    const transcript = new AgentTranscript();
    const finalAnswer = [
      streamEvent({ type: "message_start" }),
      streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "It is INC-42." } }),
      streamEvent({ type: "content_block_stop", index: 0 }),
    ];
    mapAll([...STEP_WITH_TOOL, TOOL_RESULT, ...finalAnswer]).forEach((c) => transcript.record(c));

    expect(transcript.text).toBe("Looking it up.\n\nIt is INC-42.");
    expect(transcript.reasoning).toBe("Need the ticket.");
    expect(transcript.toolCalls).toEqual([{ id: "toolu_1", name: "get_ticket", input: { id: 42 } }]);
    expect(transcript.toolResults).toEqual([{ name: "get_ticket", output: { ref: "INC-42" } }]);
  });

  it("has no reasoning when the model did not think", () => {
    expect(new AgentTranscript().reasoning).toBeUndefined();
  });
});

describe("agentRunFailure", () => {
  it("passes a successful result", () => {
    expect(agentRunFailure({ type: "result", subtype: "success", is_error: false, result: "ok" })).toBeNull();
  });

  it("ignores messages that are not results", () => {
    expect(agentRunFailure({ type: "assistant" })).toBeNull();
  });

  it("reports an API failure that ends as a 'success' flagged is_error", () => {
    expect(
      agentRunFailure({ type: "result", subtype: "success", is_error: true, result: "Invalid API key" }),
    ).toBe("Invalid API key");
  });

  it("reports an error subtype even without a message", () => {
    expect(agentRunFailure({ type: "result", subtype: "error_max_turns", is_error: true })).toBe(
      "Claude Code ended with error_max_turns",
    );
  });
});

describe("pipeAgentRun", () => {
  async function* failingRun(chunks: AgentChunk[], error: Error): AsyncGenerator<AgentChunk> {
    yield* chunks;
    throw error;
  }

  it("forwards and records every chunk", async () => {
    const written: AgentChunk[] = [];
    const transcript = new AgentTranscript();
    async function* run(): AsyncGenerator<AgentChunk> {
      yield { type: "text-start", id: "a" };
      yield { type: "text-delta", id: "a", delta: "hi" };
      yield { type: "text-end", id: "a" };
    }

    await pipeAgentRun(run(), { writer: { write: (c) => written.push(c) }, transcript, fallbackError: "fallback" });

    expect(written).toHaveLength(3);
    expect(transcript.text).toBe("hi");
  });

  it("keeps nothing the agent produces after Stop, and closes the open block", async () => {
    const written: AgentChunk[] = [];
    const transcript = new AgentTranscript();
    const stop = new AbortController();
    async function* run(): AsyncGenerator<AgentChunk> {
      yield { type: "text-start", id: "a" };
      yield { type: "text-delta", id: "a", delta: "Seen" };
      stop.abort();
      yield { type: "text-delta", id: "a", delta: " never seen" };
    }

    await pipeAgentRun(run(), {
      writer: { write: (c) => written.push(c) },
      transcript,
      fallbackError: "fallback",
      abortSignal: stop.signal,
    });

    expect(transcript.text).toBe("Seen");
    expect(written.at(-1)).toEqual({ type: "text-end", id: "a" });
  });

  it("shows a mid-run failure as a final text part after closing the open block", async () => {
    const written: AgentChunk[] = [];
    const transcript = new AgentTranscript();
    const run = failingRun(
      [{ type: "text-start", id: "a" }, { type: "text-delta", id: "a", delta: "Partial" }],
      new Error("Claude Code ended with error_max_turns"),
    );

    await pipeAgentRun(run, { writer: { write: (c) => written.push(c) }, transcript, fallbackError: "fallback" });

    expect(written[2]).toEqual({ type: "text-end", id: "a" });
    expect(transcript.text).toBe("Partial\n\n⚠️ Claude Code ended with error_max_turns");
  });

  it("ends quietly when the client aborted", async () => {
    const transcript = new AgentTranscript();
    const aborted = AbortSignal.abort();
    const run = failingRun([{ type: "start-step" }], new Error("aborted"));

    await pipeAgentRun(run, { writer: { write: () => {} }, transcript, fallbackError: "fallback", abortSignal: aborted });

    expect(transcript.text).toBe("");
  });
});

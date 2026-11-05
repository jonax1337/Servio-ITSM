import { describe, expect, it } from "vitest";
import {
  createStreamTranslator,
  estimateInputTokens,
  maxTokensFieldFor,
  toAnthropicMessage,
  toOpenAIRequest,
  type AnthropicRequest,
  type OpenAIChatChunk,
} from "@/lib/llm-proxy/translate";

const OPTIONS = { model: "gpt-test", maxTokensField: "max_tokens" } as const;

function translate(req: Partial<AnthropicRequest>) {
  return toOpenAIRequest({ messages: [], ...req }, OPTIONS);
}

describe("toOpenAIRequest", () => {
  it("joins system blocks into one leading system message and ignores cache_control", () => {
    const out = translate({
      system: [
        { type: "text", text: "First.", cache_control: { type: "ephemeral" } },
        { type: "text", text: "Second." },
      ] as AnthropicRequest["system"],
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.messages).toEqual([
      { role: "system", content: "First.\n\nSecond." },
      { role: "user", content: "hi" },
    ]);
  });

  it("accepts a plain string system prompt and always uses the lease model", () => {
    const out = translate({ system: "Be brief." });
    expect(out.model).toBe("gpt-test");
    expect(out.messages).toEqual([{ role: "system", content: "Be brief." }]);
  });

  it("maps base64 and url images and keeps mixed content as parts", () => {
    const out = translate({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
            { type: "image", source: { type: "url", url: "https://x.test/a.png" } },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
          { type: "image_url", image_url: { url: "https://x.test/a.png" } },
        ],
      },
    ]);
  });

  it("replaces documents with a text placeholder and collapses text-only parts to a string", () => {
    const out = translate({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "see" }, { type: "document" }],
        },
      ],
    });
    expect(out.messages).toEqual([
      {
        role: "user",
        content: "see\n(document attached — not supported by this model)",
      },
    ]);
  });

  it("round-trips tool_use and tool_result, emitting tool messages before user text", () => {
    const out = translate({
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "thinking" },
            { type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Berlin" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "and now?" },
            { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "sunny" }, { type: "text", text: "20C" }] },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "toolu_1", type: "function", function: { name: "weather", arguments: '{"city":"Berlin"}' } },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "sunny\n20C" },
      { role: "user", content: "and now?" },
    ]);
  });

  it("prefixes error tool results and replaces images inside tool results", () => {
    const out = translate({
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "a", is_error: true, content: "boom" },
            {
              type: "tool_result",
              tool_use_id: "b",
              content: [{ type: "image", source: { type: "url", url: "https://x.test/i.png" } }],
            },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "tool", tool_call_id: "a", content: "Error: boom" },
      { role: "tool", tool_call_id: "b", content: "(image omitted — not supported in tool results)" },
    ]);
  });

  it("keeps assistant text next to tool calls and drops thinking-only turns", () => {
    const out = translate({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking." },
            { type: "tool_use", id: "t", name: "lookup", input: {} },
          ],
        },
        { role: "assistant", content: [{ type: "redacted_thinking" }] },
      ],
    });
    expect(out.messages).toEqual([
      {
        role: "assistant",
        content: "Checking.",
        tool_calls: [{ id: "t", type: "function", function: { name: "lookup", arguments: "{}" } }],
      },
    ]);
  });

  it("converts custom tools and skips Anthropic server tools", () => {
    const out = translate({
      tools: [
        { name: "lookup", description: "Find", input_schema: { type: "object", properties: { q: { type: "string" } } } },
        { type: "custom", name: "bare" },
        { type: "web_search_20250305", name: "web_search" },
      ],
    });
    expect(out.tools).toEqual([
      {
        type: "function",
        function: { name: "lookup", description: "Find", parameters: { type: "object", properties: { q: { type: "string" } } } },
      },
      { type: "function", function: { name: "bare", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it.each([
    [{ type: "auto" }, "auto"],
    [{ type: "any" }, "required"],
    [{ type: "none" }, "none"],
    [{ type: "tool", name: "lookup" }, { type: "function", function: { name: "lookup" } }],
  ] as const)("maps tool_choice %j", (choice, expected) => {
    const out = translate({ tools: [{ name: "lookup" }], tool_choice: choice });
    expect(out.tool_choice).toEqual(expected);
  });

  it("omits tool_choice when no function tools remain", () => {
    const out = translate({ tool_choice: { type: "any" } });
    expect(out.tool_choice).toBeUndefined();
  });

  it("uses max_completion_tokens only for api.openai.com", () => {
    expect(maxTokensFieldFor("https://api.openai.com/v1")).toBe("max_completion_tokens");
    expect(maxTokensFieldFor("http://localhost:11434/v1")).toBe("max_tokens");
    expect(maxTokensFieldFor("not a url")).toBe("max_tokens");

    const req = { messages: [], max_tokens: 99 };
    const openai = toOpenAIRequest(req, { model: "m", maxTokensField: "max_completion_tokens" });
    expect(openai.max_completion_tokens).toBe(99);
    expect(openai.max_tokens).toBeUndefined();
    expect(toOpenAIRequest(req, OPTIONS).max_tokens).toBe(99);
  });

  it("passes sampling params, maps stop_sequences and drops the rest", () => {
    const out = toOpenAIRequest(
      {
        messages: [],
        temperature: 0.2,
        top_p: 0.9,
        stop_sequences: ["END"],
        thinking: { type: "enabled" },
        metadata: { user_id: "u" },
        top_k: 5,
      } as AnthropicRequest,
      OPTIONS,
    );
    expect(out).toEqual({ model: "gpt-test", messages: [], temperature: 0.2, top_p: 0.9, stop: ["END"] });
  });

  it("requests usage when streaming", () => {
    const out = translate({ stream: true });
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
    expect(translate({}).stream).toBeUndefined();
  });
});

describe("estimateInputTokens", () => {
  it("is ceil(chars / 4) over system, messages and tools", () => {
    const req: AnthropicRequest = { system: "sys", messages: [{ role: "user", content: "hello" }] };
    const chars = JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools }).length;
    expect(estimateInputTokens(req)).toBe(Math.ceil(chars / 4));
  });
});

describe("toAnthropicMessage", () => {
  it("orders thinking, text and tool_use and maps usage and stop reason", () => {
    const out = toAnthropicMessage(
      {
        choices: [
          {
            message: {
              content: "Let me check.",
              reasoning_content: "Need the weather.",
              tool_calls: [
                { id: "call_1", index: 0, function: { name: "weather", arguments: '{"city":"Berlin"}' } },
                { id: "call_2", index: 1, function: { name: "broken", arguments: "{oops" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      },
      "gpt-test",
    );
    expect(out).toMatchObject({
      type: "message",
      role: "assistant",
      model: "gpt-test",
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    expect(out.id).toMatch(/^msg_/);
    expect(out.content).toEqual([
      { type: "thinking", thinking: "Need the weather.", signature: "" },
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "call_1", name: "weather", input: { city: "Berlin" } },
      { type: "tool_use", id: "call_2", name: "broken", input: {} },
    ]);
  });

  it("reads the `reasoning` field and skips empty text", () => {
    const out = toAnthropicMessage(
      { choices: [{ message: { content: "", reasoning: "hmm" }, finish_reason: "stop" }] },
      "m",
    );
    expect(out.content).toEqual([{ type: "thinking", thinking: "hmm", signature: "" }]);
  });

  it.each([
    ["stop", "end_turn"],
    ["length", "max_tokens"],
    ["tool_calls", "tool_use"],
    ["function_call", "tool_use"],
    ["content_filter", "end_turn"],
    [null, "end_turn"],
    ["something_new", "end_turn"],
  ] as const)("maps finish_reason %s to %s", (reason, expected) => {
    const out = toAnthropicMessage({ choices: [{ message: { content: "x" }, finish_reason: reason }] }, "m");
    expect(out.stop_reason).toBe(expected);
  });

  it("reports tool_use when the server says stop but returned tool calls", () => {
    const out = toAnthropicMessage(
      {
        choices: [
          { message: { tool_calls: [{ id: "c", function: { name: "t", arguments: "{}" } }] }, finish_reason: "stop" },
        ],
      },
      "m",
    );
    expect(out.stop_reason).toBe("tool_use");
  });
});

type ParsedEvent = { type: string; data: Record<string, unknown> };

function parseEvents(events: string[]): ParsedEvent[] {
  return events.map((raw) => {
    const [eventLine, dataLine] = raw.trimEnd().split("\n");
    const type = eventLine.replace("event: ", "");
    const data = JSON.parse(dataLine.replace("data: ", "")) as Record<string, unknown>;
    expect(data.type).toBe(type);
    return { type, data };
  });
}

function runStream(chunks: OpenAIChatChunk[]): ParsedEvent[] {
  const translator = createStreamTranslator("gpt-test");
  const events = chunks.flatMap((chunk) => translator.push(chunk));
  return parseEvents([...events, ...translator.finish()]);
}

function delta(fields: NonNullable<OpenAIChatChunk["choices"]>[number]["delta"]): OpenAIChatChunk {
  return { choices: [{ delta: fields }] };
}

function call(index: number, fn: { name?: string; arguments?: string }, id?: string): OpenAIChatChunk {
  return delta({ tool_calls: [{ index, id, function: fn }] });
}

describe("createStreamTranslator", () => {
  it("emits the full event sequence for reasoning, text and two fragmented tool calls", () => {
    const events = runStream([
      delta({ reasoning_content: "Think " }),
      delta({ reasoning: "more." }),
      delta({ content: "Hel" }),
      delta({ content: "lo" }),
      call(0, { arguments: '{"ci' }),
      call(0, { name: "weather" }, "call_a"),
      call(0, { arguments: 'ty":"Berlin"}' }),
      call(1, { name: "time", arguments: "" }, "call_b"),
      call(1, { arguments: '{"tz":' }),
      call(1, { arguments: '"UTC"}' }),
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 30, completion_tokens: 11 } },
    ]);

    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    expect(events[0].data.message).toMatchObject({
      type: "message",
      role: "assistant",
      model: "gpt-test",
      content: [],
      usage: { input_tokens: 0 },
    });
    expect(events[1].data).toMatchObject({
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "" },
    });
    expect(events.slice(2, 5).map((e) => e.data.delta)).toEqual([
      { type: "thinking_delta", thinking: "Think " },
      { type: "thinking_delta", thinking: "more." },
      { type: "signature_delta", signature: "" },
    ]);
    expect(events[6].data).toMatchObject({ index: 1, content_block: { type: "text", text: "" } });
    expect(events.slice(7, 9).map((e) => e.data.delta)).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
    ]);
    // Arguments that arrived before the name are flushed once the block starts.
    expect(events[10].data).toMatchObject({
      index: 2,
      content_block: { type: "tool_use", id: "call_a", name: "weather", input: {} },
    });
    expect(events.slice(11, 13).map((e) => e.data.delta)).toEqual([
      { type: "input_json_delta", partial_json: '{"ci' },
      { type: "input_json_delta", partial_json: 'ty":"Berlin"}' },
    ]);
    expect(events[14].data).toMatchObject({
      index: 3,
      content_block: { type: "tool_use", id: "call_b", name: "time" },
    });
    expect(events.slice(15, 17).map((e) => e.data.delta)).toEqual([
      { type: "input_json_delta", partial_json: '{"tz":' },
      { type: "input_json_delta", partial_json: '"UTC"}' },
    ]);
    expect(events[18].data).toMatchObject({
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 11 },
    });
  });

  it("returns index-matching stop events", () => {
    const events = runStream([delta({ content: "a" })]);
    const start = events.find((e) => e.type === "content_block_start");
    const stop = events.find((e) => e.type === "content_block_stop");
    expect(stop?.data.index).toBe(start?.data.index);
  });

  it("treats a repeated index with a new id as a new tool call", () => {
    const events = runStream([
      call(0, { name: "a", arguments: "{}" }, "id_a"),
      call(0, { name: "b", arguments: "{}" }, "id_b"),
    ]);
    const starts = events.filter((e) => e.type === "content_block_start");
    expect(starts.map((e) => (e.data.content_block as { name: string }).name)).toEqual(["a", "b"]);
  });

  it("maps length to max_tokens", () => {
    const events = runStream([
      delta({ content: "cut" }),
      { choices: [{ delta: {}, finish_reason: "length" }] },
    ]);
    expect(events.find((e) => e.type === "message_delta")?.data.delta).toEqual({
      stop_reason: "max_tokens",
      stop_sequence: null,
    });
  });

  it("finishes a message that never received a chunk, exactly once", () => {
    const translator = createStreamTranslator("gpt-test");
    const events = parseEvents(translator.finish());
    expect(events.map((e) => e.type)).toEqual(["message_start", "message_delta", "message_stop"]);
    expect(events[1].data).toMatchObject({
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 0 },
    });
    expect(translator.finish()).toEqual([]);
    expect(translator.push(delta({ content: "late" }))).toEqual([]);
  });
});

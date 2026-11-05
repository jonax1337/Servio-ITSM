import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leaseProxyRoute, type ProxyLease } from "@/lib/llm-proxy/server";

type UpstreamCall = { url: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
type UpstreamBehavior = (call: UpstreamCall, res: import("node:http").ServerResponse) => void;

const MODEL = "upstream-model";

let upstream: Server;
let upstreamBaseURL: string;
let calls: UpstreamCall[];
let behavior: UpstreamBehavior;
const leases: ProxyLease[] = [];

function sseLine(payload: object | string): string {
  return `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`;
}

const STREAMED_TOOL_CALL_AND_TEXT: UpstreamBehavior = (_call, res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const lines = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"q":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }] },
    { choices: [{ delta: { content: "Done." } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } },
  ];
  // CRLF endings and a payload split mid-line exercise the SSE parser.
  const wire = lines.map((line) => sseLine(line).replace(/\n/g, "\r\n")).join("") + sseLine("[DONE]");
  const middle = Math.floor(wire.length / 2);
  res.write(wire.slice(0, middle));
  setTimeout(() => res.end(wire.slice(middle)), 10);
};

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const call = {
        url: req.url ?? "",
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      };
      calls.push(call);
      behavior(call, res);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamBaseURL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  leases.forEach((lease) => lease.release());
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
});

beforeEach(() => {
  calls = [];
  behavior = STREAMED_TOOL_CALL_AND_TEXT;
});

async function lease(overrides: { apiKey?: string; model?: string } = {}): Promise<ProxyLease> {
  const result = await leaseProxyRoute({ baseURL: upstreamBaseURL, model: MODEL, ...overrides });
  leases.push(result);
  return result;
}

function post(proxy: ProxyLease, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${proxy.baseURL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": proxy.token, ...headers },
    body: JSON.stringify(body),
  });
}

function parseSse(text: string) {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const [eventLine, dataLine] = block.split("\n");
      return { type: eventLine.replace("event: ", ""), data: JSON.parse(dataLine.replace("data: ", "")) };
    });
}

const REQUEST = {
  model: "claude-sonnet-4-6",
  max_tokens: 100,
  system: "Be brief.",
  messages: [{ role: "user", content: "hi" }],
};

describe("llm proxy server", () => {
  it("binds to loopback and reuses one server across leases", async () => {
    const [a, b] = await Promise.all([lease(), lease()]);
    expect(a.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(b.baseURL).toBe(a.baseURL);
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{48}$/);
  });

  it("streams Anthropic SSE for a streamed upstream tool call plus text", async () => {
    const proxy = await lease({ apiKey: "sk-upstream" });
    const res = await post(proxy, "/v1/messages?beta=true", { ...REQUEST, stream: true });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const events = parseSse(await res.text());
    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop",
      "content_block_start", "content_block_delta", "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(events[0].data.message.model).toBe(MODEL);
    expect(events[1].data.content_block).toEqual({ type: "tool_use", id: "call_1", name: "lookup", input: {} });
    expect(events[2].data.delta).toEqual({ type: "input_json_delta", partial_json: '{"q":' });
    expect(events[5].data.content_block).toEqual({ type: "text", text: "" });
    expect(events[8].data).toMatchObject({
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 3 },
    });
  });

  it("forwards a translated request with the upstream key, never the proxy token", async () => {
    const proxy = await lease({ apiKey: "sk-upstream" });
    await (await post(proxy, "/v1/messages", { ...REQUEST, stream: true })).text();

    const [call] = calls;
    expect(call.url).toBe("/v1/chat/completions");
    expect(call.headers.authorization).toBe("Bearer sk-upstream");
    expect(call.body).toMatchObject({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 100,
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("omits the Authorization header when no upstream key is set", async () => {
    const proxy = await lease();
    await (await post(proxy, "/v1/messages", { ...REQUEST, stream: true })).text();
    expect(calls[0].headers.authorization).toBeUndefined();
  });

  it("answers non-streaming requests with an Anthropic message", async () => {
    behavior = (_call, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "Hello", reasoning_content: "hmm" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      );
    };
    const proxy = await lease();
    const res = await post(proxy, "/v1/messages", REQUEST);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      type: "message",
      role: "assistant",
      model: MODEL,
      content: [
        { type: "thinking", thinking: "hmm", signature: "" },
        { type: "text", text: "Hello" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    expect(calls[0].body.stream).toBeUndefined();
  });

  it("accepts the token as a Bearer Authorization header", async () => {
    behavior = (_call, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    };
    const proxy = await lease();
    const res = await fetch(`${proxy.baseURL}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${proxy.token}` },
      body: JSON.stringify(REQUEST),
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown tokens with an Anthropic 401", async () => {
    const proxy = await lease();
    const res = await post({ ...proxy, token: "nope" }, "/v1/messages", REQUEST);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      type: "error",
      error: { type: "authentication_error", message: expect.any(String) },
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects requests without any token", async () => {
    const proxy = await lease();
    const res = await fetch(`${proxy.baseURL}/v1/messages`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("revokes the token on release, idempotently", async () => {
    const proxy = await lease();
    expect((await post(proxy, "/v1/messages/count_tokens", REQUEST)).status).toBe(200);
    proxy.release();
    proxy.release();
    expect((await post(proxy, "/v1/messages/count_tokens", REQUEST)).status).toBe(401);
  });

  it("estimates tokens on count_tokens", async () => {
    const proxy = await lease();
    const res = await post(proxy, "/v1/messages/count_tokens", REQUEST);
    const serialized = JSON.stringify({ system: REQUEST.system, messages: REQUEST.messages });
    expect(await res.json()).toEqual({ input_tokens: Math.ceil(serialized.length / 4) });
    expect(calls).toHaveLength(0);
  });

  it("returns a 404 Anthropic error for unknown routes", async () => {
    const proxy = await lease();
    const res = await post(proxy, "/v1/models", {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("not_found_error");
  });

  it("rejects malformed bodies with 400", async () => {
    const proxy = await lease();
    const res = await fetch(`${proxy.baseURL}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": proxy.token },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(((await post(proxy, "/v1/messages", { model: "x" })).status)).toBe(400);
  });

  it("rejects bodies above the size cap with 413", async () => {
    const proxy = await lease();
    const res = await fetch(`${proxy.baseURL}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": proxy.token },
      body: "x".repeat(33 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it("passes upstream error statuses through with the upstream body", async () => {
    behavior = (_call, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end('{"error":"slow down"}');
    };
    const proxy = await lease();
    const res = await post(proxy, "/v1/messages", REQUEST);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { type: string; error: { type: string; message: string } };
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");
    expect(body.error.message).toContain("slow down");
  });

  it("returns 502 when the upstream connection fails", async () => {
    behavior = (_call, res) => {
      res.socket?.destroy();
    };
    const proxy = await lease();
    const res = await post(proxy, "/v1/messages", REQUEST);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("api_error");
  });

  it("emits an SSE error event when the upstream fails mid-stream", async () => {
    behavior = (_call, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseLine({ choices: [{ delta: { content: "par" } }] }));
      res.write("data: {broken\n\n");
      res.end();
    };
    const proxy = await lease();
    const res = await post(proxy, "/v1/messages", { ...REQUEST, stream: true });
    const events = parseSse(await res.text());

    expect(res.status).toBe(200);
    expect(events.at(-1)).toMatchObject({ type: "error", data: { type: "error", error: { type: "api_error" } } });
    expect(events.map((e) => e.type)).not.toContain("message_stop");
  });

  it("aborts the upstream request when the client disconnects", async () => {
    let upstreamClosed: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    behavior = (_call, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseLine({ choices: [{ delta: { content: "start" } }] }));
      res.on("close", () => upstreamClosed());
    };
    const proxy = await lease();
    const controller = new AbortController();
    const res = await fetch(`${proxy.baseURL}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": proxy.token },
      body: JSON.stringify({ ...REQUEST, stream: true }),
      signal: controller.signal,
    });
    await res.body!.getReader().read();
    controller.abort();
    await closed;
  });

  describe("upstream output-token cap", () => {
    const CAP = 16384;
    const REJECT_ABOVE_CAP: UpstreamBehavior = (call, res) => {
      const sent = call.body.max_tokens as number;
      if (sent > CAP) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error: { message: `max_tokens is too large: ${sent}. This model supports at most ${CAP} completion tokens.` },
        }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }));
    };

    it("retries once with the cap from the error, then sends the learned cap directly", async () => {
      behavior = REJECT_ABOVE_CAP;
      const proxy = await lease({ model: "capped-model" });
      const big = { ...REQUEST, max_tokens: 32000 };

      expect((await post(proxy, "/v1/messages", big)).status).toBe(200);
      expect(calls.map((c) => c.body.max_tokens)).toEqual([32000, CAP]);

      calls = [];
      expect((await post(proxy, "/v1/messages", big)).status).toBe(200);
      expect(calls.map((c) => c.body.max_tokens)).toEqual([CAP]);
    });

    it("falls back to 8192 when the error states no number", async () => {
      behavior = (call, res) => {
        const sent = call.body.max_tokens as number;
        res.writeHead(sent > 8192 ? 400 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(sent > 8192
          ? { error: { message: "invalid max_tokens value" } }
          : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }));
      };
      const proxy = await lease({ model: "silent-capped-model" });
      expect((await post(proxy, "/v1/messages", { ...REQUEST, max_tokens: 32000 })).status).toBe(200);
      expect(calls.map((c) => c.body.max_tokens)).toEqual([32000, 8192]);
    });

    it("ignores an implausibly small stated cap and does not remember it", async () => {
      behavior = (call, res) => {
        const sent = call.body.max_tokens as number;
        res.writeHead(sent > 8192 ? 400 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(sent > 8192
          ? { error: { message: "max_tokens must be at most 512" } }
          : { choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }));
      };
      const proxy = await lease({ model: "misparse-model" });
      expect((await post(proxy, "/v1/messages", { ...REQUEST, max_tokens: 32000 })).status).toBe(200);
      expect(calls.map((c) => c.body.max_tokens)).toEqual([32000, 8192]);
    });

    it("does not retry unrelated 400s", async () => {
      behavior = (_call, res) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "bad tool schema" } }));
      };
      const proxy = await lease({ model: "other-model" });
      expect((await post(proxy, "/v1/messages", { ...REQUEST, max_tokens: 32000 })).status).toBe(400);
      expect(calls).toHaveLength(1);
    });
  });
});

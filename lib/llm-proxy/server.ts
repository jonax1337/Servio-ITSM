import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  createStreamTranslator,
  estimateInputTokens,
  maxTokensFieldFor,
  toAnthropicMessage,
  toOpenAIRequest,
  type AnthropicRequest,
  type OpenAIChatChunk,
  type OpenAIChatResponse,
} from "./translate";
import {
  clampMaxTokens,
  FALLBACK_TOKEN_CAP,
  isTokenLimitError,
  LearnedTokenCaps,
  MIN_LEARNED_TOKEN_CAP,
  parseTokenCap,
} from "./token-cap";

/**
 * Built-in localhost proxy that lets Claude Code (Anthropic Messages API) talk
 * to any OpenAI-compatible endpoint. Each lease maps a random token to an
 * upstream, so the upstream API key stays inside this Node process.
 */

export type ProxyUpstream = {
  /** OpenAI-compatible base including /v1. */
  baseURL: string;
  /** Sent upstream as `Authorization: Bearer`; omitted when empty. */
  apiKey?: string;
  /** Upstream model id; always used, whatever model Claude Code asks for. */
  model: string;
};

export type ProxyLease = {
  /** Goes into ANTHROPIC_BASE_URL. */
  baseURL: string;
  /** Goes into ANTHROPIC_AUTH_TOKEN. */
  token: string;
  /** Unregisters the token; idempotent. */
  release(): void;
};

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_ERROR_MESSAGE_CHARS = 2000;
const TOKEN_BYTES = 24;
const LOOPBACK = "127.0.0.1";

/** Output-token caps learned from upstream 400s, per upstream baseURL + model. */
const learnedTokenCaps = new LearnedTokenCaps();

function tokenCapKey(upstream: ProxyUpstream): string {
  return `${upstream.baseURL}|${upstream.model}`;
}

type AnthropicErrorType =
  | "api_error"
  | "authentication_error"
  | "invalid_request_error"
  | "not_found_error"
  | "rate_limit_error";

class ProxyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: AnthropicErrorType,
    message: string,
  ) {
    super(message);
  }
}

function errorBody(errorType: AnthropicErrorType, message: string) {
  return { type: "error", error: { type: errorType, message } };
}

function errorTypeForStatus(status: number): AnthropicErrorType {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 404) return "not_found_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 400 && status < 500) return "invalid_request_error";
  return "api_error";
}

// ---- Singleton -------------------------------------------------------------

type ProxyState = {
  routes: Map<string, ProxyUpstream>;
  server: Server;
  port: Promise<number>;
};

/** On globalThis so Next dev HMR re-evaluating this module reuses the server. */
const STATE_KEY = Symbol.for("servio.llmProxy");
type GlobalWithProxy = typeof globalThis & { [STATE_KEY]?: ProxyState };

function proxyState(): ProxyState {
  const holder = globalThis as GlobalWithProxy;
  holder[STATE_KEY] ??= startProxy();
  return holder[STATE_KEY];
}

function startProxy(): ProxyState {
  const routes = new Map<string, ProxyUpstream>();
  const server = createServer((req, res) => {
    handleRequest(req, res, routes).catch((error) => failRequest(res, error));
  });
  const port = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
  // A failed bind must not poison later leases.
  port.catch(() => {
    delete (globalThis as GlobalWithProxy)[STATE_KEY];
  });
  server.unref();
  return { routes, server, port };
}

export async function leaseProxyRoute(
  upstream: ProxyUpstream,
): Promise<ProxyLease> {
  const { routes, port } = proxyState();
  const listeningPort = await port;
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  routes.set(token, { ...upstream });
  return {
    baseURL: `http://${LOOPBACK}:${listeningPort}`,
    token,
    release: () => {
      routes.delete(token);
    },
  };
}

// ---- Request handling ------------------------------------------------------

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routes: Map<string, ProxyUpstream>,
): Promise<void> {
  const upstream = routes.get(requestToken(req) ?? "");
  if (!upstream) {
    throw new ProxyHttpError(401, "authentication_error", "Invalid or missing proxy token.");
  }
  const { pathname } = new URL(req.url ?? "/", `http://${LOOPBACK}`);
  if (req.method === "POST" && pathname === "/v1/messages") {
    return handleMessages(req, res, upstream);
  }
  if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
    return handleCountTokens(req, res);
  }
  throw new ProxyHttpError(404, "not_found_error", `No route for ${req.method} ${pathname}.`);
}

function requestToken(req: IncomingMessage): string | undefined {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey) return apiKey;
  return req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

async function handleCountTokens(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const request = await readAnthropicRequest(req);
  sendJson(res, 200, { input_tokens: estimateInputTokens(request) });
}

async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: ProxyUpstream,
): Promise<void> {
  const request = await readAnthropicRequest(req);
  const abort = abortOnClientClose(res);
  try {
    const response = await postWithTokenCap(upstream, request, abort.signal);
    if (request.stream) {
      await relayStream(res, response, upstream.model);
    } else {
      const body = (await response.json()) as OpenAIChatResponse;
      sendJson(res, 200, toAnthropicMessage(body, upstream.model));
    }
  } catch (error) {
    // The client is gone; there is nobody left to answer.
    if (abort.signal.aborted) return;
    throw error;
  }
}

/** Posts the request; on an upstream max-token 400 retries once with a lower cap and remembers it. */
async function postWithTokenCap(
  upstream: ProxyUpstream,
  request: AnthropicRequest,
  signal: AbortSignal,
): Promise<Response> {
  const send = (maxTokens: number | undefined) =>
    postChatCompletion(
      upstream,
      toOpenAIRequest(
        { ...request, max_tokens: maxTokens },
        { model: upstream.model, maxTokensField: maxTokensFieldFor(upstream.baseURL) },
      ),
      signal,
    );
  const requested = request.max_tokens;
  if (requested === undefined) return send(undefined);

  const key = tokenCapKey(upstream);
  const initial = clampMaxTokens(requested, learnedTokenCaps.get(key));
  try {
    return await send(initial);
  } catch (error) {
    if (!(error instanceof ProxyHttpError) || error.status !== 400 || !isTokenLimitError(error.message)) {
      throw error;
    }
    const stated = parseTokenCap(error.message, initial);
    const plausible = stated !== undefined && stated >= MIN_LEARNED_TOKEN_CAP ? stated : undefined;
    const cap = plausible ?? Math.min(FALLBACK_TOKEN_CAP, initial - 1);
    if (cap < 1) throw error;
    learnedTokenCaps.learn(key, cap);
    return send(cap);
  }
}

function abortOnClientClose(res: ServerResponse): AbortController {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller;
}

async function readAnthropicRequest(
  req: IncomingMessage,
): Promise<AnthropicRequest> {
  const text = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProxyHttpError(400, "invalid_request_error", "Request body is not valid JSON.");
  }
  const messages = (parsed as Partial<AnthropicRequest> | null)?.messages;
  if (!Array.isArray(messages)) {
    throw new ProxyHttpError(400, "invalid_request_error", "`messages` must be an array.");
  }
  return parsed as AnthropicRequest;
}

/**
 * Oversized bodies are drained rather than abandoned: answering 413 while the
 * client is still uploading resets the connection and the client never sees it.
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) {
    throw new ProxyHttpError(413, "invalid_request_error", "Request body is too large.");
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ---- Upstream --------------------------------------------------------------

async function postChatCompletion(
  upstream: ProxyUpstream,
  payload: object,
  signal: AbortSignal,
): Promise<Response> {
  const url = `${upstream.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (upstream.apiKey) headers.authorization = `Bearer ${upstream.apiKey}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    throw new ProxyHttpError(502, "api_error", `Upstream request failed: ${describe(error)}`);
  }
  if (!response.ok) throw await upstreamStatusError(response);
  return response;
}

async function upstreamStatusError(response: Response): Promise<ProxyHttpError> {
  const body = (await response.text().catch(() => "")).slice(0, MAX_ERROR_MESSAGE_CHARS);
  return new ProxyHttpError(
    response.status,
    errorTypeForStatus(response.status),
    `Upstream returned ${response.status}: ${body}`,
  );
}

async function relayStream(
  res: ServerResponse,
  response: Response,
  model: string,
): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const translator = createStreamTranslator(model);
  try {
    for await (const data of readSseData(response.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as OpenAIChatChunk & {
        error?: { message?: string };
      };
      if (chunk.error) {
        throw new Error(chunk.error.message ?? "upstream reported an error");
      }
      writeEvents(res, translator.push(chunk));
    }
    writeEvents(res, translator.finish());
  } catch (error) {
    if (res.destroyed) return;
    const failure = errorBody("api_error", `Upstream stream failed: ${describe(error)}`);
    res.write(`event: error\ndata: ${JSON.stringify(failure)}\n\n`);
  }
  res.end();
}

function writeEvents(res: ServerResponse, events: string[]): void {
  for (const event of events) res.write(event);
}

/** Yields the payload of each `data:` line; tolerates CRLF and split reads. */
async function* readSseData(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string> {
  if (!body) return;
  const decoder = new TextDecoder();
  let buffered = "";
  const reader = body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    buffered += decoder.decode(read.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const data = dataPayload(line);
      if (data) yield data;
    }
  }
  const last = dataPayload(buffered + decoder.decode());
  if (last) yield last;
}

function dataPayload(line: string): string | undefined {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed.startsWith("data:")) return undefined;
  return trimmed.slice("data:".length).trim() || undefined;
}

// ---- Responses -------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function failRequest(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof ProxyHttpError) {
    sendJson(res, error.status, errorBody(error.errorType, error.message));
    return;
  }
  sendJson(res, 500, errorBody("api_error", describe(error)));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

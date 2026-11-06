// Minimal Docker Engine API client (no dependencies). Only the calls the update
// flow needs; reference: https://docs.docker.com/reference/api/engine/
import http from "node:http";

// The daemon is reached over a unix socket / named pipe, or over TCP through a
// docker-socket-proxy (DOCKER_HOST=tcp://host:port); see updater/README.md.

/**
 * Engine API version prefix. v1.44 is the oldest version every supported
 * engine accepts: Engine 25+ speaks it, and Engine 29.0-29.2 raised its floor
 * to 1.44. Override with DOCKER_API_VERSION for Engine 24 (v1.43).
 */
export const DEFAULT_API_VERSION = "v1.44";
export const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/**
 * @typedef {{ socketPath: string } | { host: string, port: number }} DockerEndpoint
 * @typedef {{ method: string, path: string, headers?: Record<string, string>, body?: string, signal?: AbortSignal }} DockerRequest
 * @typedef {{ status: number, body: AsyncIterable<Uint8Array> }} DockerResponse
 * @typedef {(request: DockerRequest) => Promise<DockerResponse>} DockerTransport
 */

export class DockerApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status HTTP status of the failed call (200 for in-stream pull errors)
   */
  constructor(message, status) {
    super(message);
    this.name = "DockerApiError";
    this.status = status;
  }
}

/**
 * HTTP to the Docker daemon: over its unix socket (or a Windows named pipe), or over TCP.
 *
 * @param {DockerEndpoint & { idleTimeoutMs?: number }} options
 * @returns {DockerTransport}
 */
export function createTransport({ idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, ...endpoint }) {
  return ({ method, path, headers, body, signal }) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          ...endpoint,
          method,
          path,
          signal,
          headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        },
        (response) => resolve({ status: response.statusCode ?? 0, body: response }),
      );
      request.setTimeout(idleTimeoutMs, () => {
        request.destroy(new Error(`Docker socket idle for ${idleTimeoutMs} ms (${method} ${path})`));
      });
      request.on("error", reject);
      request.end(body);
    });
}

/**
 * @param {AsyncIterable<Uint8Array>} body
 * @returns {Promise<string>}
 */
async function readText(body) {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of body) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/**
 * Splits a newline-delimited JSON stream (the `images/create` progress format)
 * into parsed frames, tolerating frames split across chunks.
 *
 * @param {AsyncIterable<Uint8Array>} body
 * @returns {AsyncGenerator<any>}
 */
export async function* jsonFrames(body) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield parseFrame(line);
  }
  pending += decoder.decode();
  if (pending.trim()) yield parseFrame(pending);
}

/** @param {string} line */
function parseFrame(line) {
  try {
    return JSON.parse(line);
  } catch {
    throw new DockerApiError(`Unparseable frame in Docker stream: ${line.slice(0, 200)}`, 200);
  }
}

/**
 * @param {{ transport?: DockerTransport, socketPath?: string, host?: string, port?: number, apiVersion?: string, registryAuth?: string }} [options]
 *   `host`+`port` select TCP and win over `socketPath`. `registryAuth` is the base64url-encoded
 *   JSON auth config sent as `X-Registry-Auth` when pulling.
 */
export function createDockerClient({
  socketPath = DEFAULT_SOCKET_PATH,
  host,
  port,
  apiVersion = DEFAULT_API_VERSION,
  registryAuth,
  transport = createTransport(host && port ? { host, port } : { socketPath }),
} = {}) {
  /**
   * @param {string} method
   * @param {string} path path without version prefix
   * @param {{ query?: Record<string, string>, body?: unknown, headers?: Record<string, string>, versioned?: boolean, signal?: AbortSignal }} [options]
   */
  async function send(method, path, { query, body, headers, versioned = true, signal } = {}) {
    const queryString = query ? `?${new URLSearchParams(query)}` : "";
    return transport({
      method,
      path: `${versioned ? `/${apiVersion}` : ""}${path}${queryString}`,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }

  /**
   * Sends a request and returns the response when its status is in `okStatuses`.
   *
   * @param {string} method
   * @param {string} path
   * @param {number[]} okStatuses
   * @param {Parameters<typeof send>[2]} [options]
   */
  async function call(method, path, okStatuses, options) {
    const response = await send(method, path, options);
    if (!okStatuses.includes(response.status)) throw await toApiError(method, path, response);
    return response;
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {DockerResponse} response
   */
  async function toApiError(method, path, response) {
    const text = await readText(response.body);
    let message = text.trim();
    try {
      message = JSON.parse(text).message ?? message;
    } catch {
      // Non-JSON error body: the raw text is the best message available.
    }
    return new DockerApiError(`${method} ${path} -> ${response.status}: ${message || "no message"}`, response.status);
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {number[]} okStatuses
   * @param {Parameters<typeof send>[2]} [options]
   */
  async function callJson(method, path, okStatuses, options) {
    const response = await call(method, path, okStatuses, options);
    return JSON.parse(await readText(response.body));
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {number[]} okStatuses
   * @param {Parameters<typeof send>[2]} [options]
   */
  async function callVoid(method, path, okStatuses, options) {
    const response = await call(method, path, okStatuses, options);
    await readText(response.body);
  }

  const containerPath = (/** @type {string} */ id) => `/containers/${encodeURIComponent(id)}`;

  return {
    /** Resolves when the daemon answers `GET /_ping`; rejects otherwise. */
    async ping() {
      await callVoid("GET", "/_ping", [200], { versioned: false });
    },

    /** @param {string} id container name or id */
    inspectContainer(id) {
      return callJson("GET", `${containerPath(id)}/json`, [200]);
    },

    /** @param {string} ref image name, tag or id */
    inspectImage(ref) {
      return callJson("GET", `/images/${ref.split("/").map(encodeURIComponent).join("/")}/json`, [200]);
    },

    /**
     * @param {string} label `key=value`
     * @returns {Promise<Array<{ Id: string, Names: string[] }>>} all containers (running or not) carrying the label
     */
    listContainers(label) {
      return callJson("GET", "/containers/json", [200], {
        query: { all: "true", filters: JSON.stringify({ label: [label] }) },
      });
    },

    /**
     * Pulls `repo:tag`. The daemon answers 200 and streams progress frames; a
     * frame with `error`/`errorDetail` means the pull failed despite the 200.
     *
     * @param {string} repo
     * @param {string} tag
     * @param {{ signal?: AbortSignal }} [options] aborting cancels the pull (the daemon stops when the connection closes)
     */
    async pullImage(repo, tag, { signal } = {}) {
      const response = await call("POST", "/images/create", [200], {
        query: { fromImage: repo, tag },
        headers: registryAuth ? { "X-Registry-Auth": registryAuth } : undefined,
        signal,
      });
      for await (const frame of jsonFrames(response.body)) {
        if (frame.error || frame.errorDetail) {
          throw new DockerApiError(`Pulling ${repo}:${tag} failed: ${frame.errorDetail?.message ?? frame.error}`, 200);
        }
      }
    },

    /**
     * 304 (already stopped) counts as success.
     *
     * @param {string} id
     * @param {number} timeoutSec grace period before the daemon sends SIGKILL
     */
    stopContainer(id, timeoutSec) {
      return callVoid("POST", `${containerPath(id)}/stop`, [204, 304], { query: { t: String(timeoutSec) } });
    },

    /** 304 (already started) counts as success. @param {string} id */
    startContainer(id) {
      return callVoid("POST", `${containerPath(id)}/start`, [204, 304]);
    },

    /**
     * @param {string} id
     * @param {string} name
     */
    renameContainer(id, name) {
      return callVoid("POST", `${containerPath(id)}/rename`, [204], { query: { name } });
    },

    /**
     * @param {string} name
     * @param {Record<string, any>} spec body for `POST /containers/create` (Config fields + HostConfig + NetworkingConfig)
     * @returns {Promise<{ Id: string }>}
     */
    createContainer(name, spec) {
      return callJson("POST", "/containers/create", [201], { query: { name }, body: spec });
    },

    /**
     * @param {string} network network name or id
     * @param {string} container
     * @param {Record<string, any>} [endpointConfig]
     */
    connectNetwork(network, container, endpointConfig = {}) {
      return callVoid("POST", `/networks/${encodeURIComponent(network)}/connect`, [200], {
        body: { Container: container, EndpointConfig: endpointConfig },
      });
    },

    /**
     * @param {string} id
     * @param {{ force?: boolean }} [options]
     */
    removeContainer(id, { force = false } = {}) {
      return callVoid("DELETE", containerPath(id), [204], { query: { force: String(force) } });
    },
  };
}

/** @typedef {ReturnType<typeof createDockerClient>} DockerClient */

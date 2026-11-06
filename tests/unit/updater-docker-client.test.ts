import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_API_VERSION,
  DockerApiError,
  DockerUnreachableError,
  createDockerClient,
  jsonFrames,
  type DockerTransport,
} from "../../updater/docker-client.mjs";

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: RecordedRequest, response: ServerResponse) => void;

let server: Server;
let socketPath: string;
let workDir: string;
let requests: RecordedRequest[];
let handler: Handler;

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "servio-docker-"));
  // Windows named pipes take the place of unix sockets; node:http serves both.
  socketPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\servio-updater-test-${process.pid}-${Date.now()}`
      : join(workDir, "docker.sock");
  requests = [];
  handler = (_request, response) => json(response, 200, {});
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const recorded = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      };
      requests.push(recorded);
      handler(recorded, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(workDir, { recursive: true, force: true });
});

const client = (options: { registryAuth?: string; apiVersion?: string } = {}) => createDockerClient({ socketPath, ...options });

describe("docker client over a local socket", () => {
  it("pings without a version prefix", async () => {
    handler = (_request, response) => response.end("OK");

    await client().ping();

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /_ping"]);
  });

  it("rejects ping when the daemon answers with an error", async () => {
    handler = (_request, response) => json(response, 500, { message: "daemon is shutting down" });

    await expect(client().ping()).rejects.toThrow("daemon is shutting down");
  });

  it("rejects ping when nothing listens on the socket", async () => {
    await new Promise((resolve) => server.close(resolve));
    server = createServer();

    await expect(client().ping()).rejects.toBeInstanceOf(DockerUnreachableError);
  });

  it("prefixes every API call with the configured version", async () => {
    handler = (_request, response) => json(response, 200, { Id: "abc" });

    await client().inspectContainer("servio-web-1");
    await client({ apiVersion: "v1.43" }).inspectImage("ghcr.io/jonax1337/servio:1.0.0");

    expect(requests.map((r) => r.url)).toEqual([
      `/${DEFAULT_API_VERSION}/containers/servio-web-1/json`,
      "/v1.43/images/ghcr.io/jonax1337/servio%3A1.0.0/json",
    ]);
  });

  it("pulls with fromImage and tag query parameters and the registry auth header", async () => {
    handler = (_request, response) => response.end('{"status":"Pulling from jonax1337/servio"}\r\n{"status":"Status: Downloaded"}\r\n');

    await client({ registryAuth: "eyJ1c2VybmFtZSI6InUifQ" }).pullImage("ghcr.io/jonax1337/servio", "0.3.0");

    const [request] = requests;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`/${DEFAULT_API_VERSION}/images/create?fromImage=ghcr.io%2Fjonax1337%2Fservio&tag=0.3.0`);
    expect(request.headers["x-registry-auth"]).toBe("eyJ1c2VybmFtZSI6InUifQ");
  });

  it("sends no registry auth header when none is configured", async () => {
    handler = (_request, response) => response.end('{"status":"ok"}\n');

    await client().pullImage("ghcr.io/jonax1337/servio", "0.3.0");

    expect(requests[0].headers).not.toHaveProperty("x-registry-auth");
  });

  it("treats an error frame in a 200 pull stream as a failure", async () => {
    handler = (_request, response) => {
      response.writeHead(200);
      response.write('{"status":"Pulling fs layer"}\n');
      response.end('{"errorDetail":{"message":"manifest unknown"},"error":"manifest unknown"}\n');
    };

    await expect(client().pullImage("ghcr.io/jonax1337/servio", "9.9.9")).rejects.toThrow(
      "Pulling ghcr.io/jonax1337/servio:9.9.9 failed: manifest unknown",
    );
  });

  it("maps a non-200 pull to the daemon's error message", async () => {
    handler = (_request, response) => json(response, 404, { message: "repository does not exist" });

    const failure = await client().pullImage("ghcr.io/jonax1337/nope", "1.0.0").catch((error) => error);

    expect(failure).toBeInstanceOf(DockerApiError);
    expect(failure.status).toBe(404);
    expect(failure.message).toContain("repository does not exist");
  });

  it("stops with the timeout as t and accepts 304 for an already stopped container", async () => {
    handler = (_request, response) => {
      response.writeHead(304);
      response.end();
    };

    await client().stopContainer("servio-web-1", 30);

    expect(requests[0]).toMatchObject({ method: "POST", url: `/${DEFAULT_API_VERSION}/containers/servio-web-1/stop?t=30` });
  });

  it("renames, starts and removes with the documented verbs and queries", async () => {
    handler = (_request, response) => {
      response.writeHead(204);
      response.end();
    };
    const docker = client();

    await docker.renameContainer("abc", "servio-web-1-pre-0.2.0");
    await docker.startContainer("abc");
    await docker.removeContainer("abc", { force: true });

    expect(requests.map((r) => `${r.method} ${r.url.replace(`/${DEFAULT_API_VERSION}`, "")}`)).toEqual([
      "POST /containers/abc/rename?name=servio-web-1-pre-0.2.0",
      "POST /containers/abc/start",
      "DELETE /containers/abc?force=true",
    ]);
  });

  it("updates a container's restart policy with a JSON body", async () => {
    handler = (_request, response) => json(response, 200, { Warnings: [] });

    await client().updateContainer("abc", { RestartPolicy: { Name: "no" } });

    expect(requests[0]).toMatchObject({ method: "POST", url: `/${DEFAULT_API_VERSION}/containers/abc/update` });
    expect(JSON.parse(requests[0].body)).toEqual({ RestartPolicy: { Name: "no" } });
  });

  it("creates a container by name with the spec as JSON body and returns its id", async () => {
    handler = (_request, response) => json(response, 201, { Id: "new123", Warnings: [] });
    const spec = { Image: "ghcr.io/jonax1337/servio:0.3.0", HostConfig: { Binds: ["v:/data"] }, NetworkingConfig: { EndpointsConfig: {} } };

    const created = await client().createContainer("servio-web-1", spec);

    expect(created.Id).toBe("new123");
    expect(requests[0].url).toBe(`/${DEFAULT_API_VERSION}/containers/create?name=servio-web-1`);
    expect(requests[0].headers["content-type"]).toBe("application/json");
    expect(JSON.parse(requests[0].body)).toEqual(spec);
  });

  it("connects a container to a network with Container and EndpointConfig", async () => {
    handler = (_request, response) => response.end();

    await client().connectNetwork("db_net", "new123", { Aliases: ["web"] });

    expect(requests[0].url).toBe(`/${DEFAULT_API_VERSION}/networks/db_net/connect`);
    expect(JSON.parse(requests[0].body)).toEqual({ Container: "new123", EndpointConfig: { Aliases: ["web"] } });
  });

  it("lists containers by label filter, including stopped ones", async () => {
    handler = (_request, response) => json(response, 200, [{ Id: "abc", Names: ["/servio-web-1"] }]);

    const containers = await client().listContainers("servio.updater.managed=true");

    expect(containers).toHaveLength(1);
    const url = new URL(requests[0].url, "http://docker");
    expect(url.pathname).toBe(`/${DEFAULT_API_VERSION}/containers/json`);
    expect(url.searchParams.get("all")).toBe("true");
    expect(JSON.parse(url.searchParams.get("filters")!)).toEqual({ label: ["servio.updater.managed=true"] });
  });

  it("fails with status and method/path context on an unexpected status", async () => {
    handler = (_request, response) => json(response, 409, { message: "name already in use" });

    const failure = await client().renameContainer("abc", "taken").catch((error) => error);

    expect(failure.status).toBe(409);
    expect(failure.message).toBe(`POST /containers/abc/rename -> 409: name already in use`);
  });
});

describe("docker client: pull deadline and TCP endpoint", () => {
  it("cancels a pull whose abort signal fires while the daemon is still silent", async () => {
    handler = () => {}; // the daemon accepts the request and never answers
    const controller = new AbortController();

    const pull = client().pullImage("ghcr.io/jonax1337/servio", "0.3.0", { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort(new Error("deadline"));

    // The caller's own abort, not an unreachable daemon: it must not be retried.
    await expect(pull).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toHaveLength(1);
  });

  it("talks to a docker-socket-proxy over TCP when host and port are given", async () => {
    const proxy = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ seen: request.url, host: request.headers.host }));
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const { port } = proxy.address() as { port: number };

    try {
      const result = await createDockerClient({ host: "127.0.0.1", port }).inspectContainer("servio-web");
      expect(result.seen).toBe(`/${DEFAULT_API_VERSION}/containers/servio-web/json`);
      expect(result.host).toBe(`127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => proxy.close(resolve));
    }
  });
});

describe("jsonFrames", () => {
  const stream = (...chunks: string[]) =>
    (async function* () {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk);
    })();
  const collect = async (body: AsyncIterable<Uint8Array>) => {
    const frames = [];
    for await (const frame of jsonFrames(body)) frames.push(frame);
    return frames;
  };

  it("reassembles frames split across chunks and handles CRLF and a missing final newline", async () => {
    expect(await collect(stream('{"a":1}\r\n{"b"', ':2}\n{"c":3}'))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it("does not split multi-byte characters across chunks", async () => {
    const bytes = new TextEncoder().encode('{"status":"ü"}\n');
    const split = bytes.indexOf(0xc3) + 1;
    const chunks = (async function* () {
      yield bytes.slice(0, split);
      yield bytes.slice(split);
    })();

    expect(await collect(chunks)).toEqual([{ status: "ü" }]);
  });

  it("fails on a frame that is not JSON", async () => {
    await expect(collect(stream("not json\n"))).rejects.toThrow("Unparseable frame");
  });
});

describe("docker client with an injected transport", () => {
  it("works against any transport, so tests need no socket", async () => {
    const transport: DockerTransport = async ({ method, path }) => ({
      status: 200,
      body: (async function* () {
        yield new TextEncoder().encode(JSON.stringify({ seen: `${method} ${path}` }));
      })(),
    });

    const result = await createDockerClient({ transport }).inspectContainer("x");

    expect(result).toEqual({ seen: `GET /${DEFAULT_API_VERSION}/containers/x/json` });
  });
});

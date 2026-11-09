/* eslint-disable @typescript-eslint/no-explicit-any -- Docker inspect/create payloads are untyped Engine API JSON */
// Shared fixtures for the updater tests: an in-memory Docker, a sample Servio
// container and a temp-dir harness with a fake clock. Not a test file itself.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerApiError, DockerUnreachableError } from "../../updater/docker-client.mjs";
import type { DockerClient } from "../../updater/docker-client.mjs";
import { loadConfig } from "../../updater/config.mjs";
import { createUpdateFlow } from "../../updater/update-flow.mjs";

export const IMAGE_REPO = "ghcr.io/test/servio";
export const CONTAINER_NAME = "servio-web-1";
export const OLD_VERSION = "0.2.0";
export const NEW_VERSION = "0.3.0";
export const OLD_DB = Buffer.from("old-database-bytes");
export const OLD_WAL = Buffer.from("old-wal-bytes");

/**
 * What a container does after `start`: becomes healthy, never does, turns unhealthy, exits, crashes right after
 * becoming healthy (Docker then restarts it if its restart policy says so), or was restarted between two polls
 * and is already healthy again.
 */
type Plan = "healthy" | "never-healthy" | "unhealthy" | "exits" | "crashes-after-healthy" | "restarted-after-healthy";

/** Restart policies under which Docker restarts a container that exited on its own. */
const RESTARTING_POLICIES = new Set(["always", "unless-stopped", "on-failure"]);

export interface FakeContainer {
  Id: string;
  Name: string;
  Image: string;
  Config: Record<string, any>;
  HostConfig: Record<string, any>;
  NetworkSettings: { Networks: Record<string, any> };
  Mounts: any[];
  State: { Running: boolean; Restarting: boolean; ExitCode: number; StartedAt?: string; Health?: { Status: string } };
  RestartCount?: number;
}

const notFound = (what: string) => new DockerApiError(`No such container: ${what}`, 404);

/** What the Docker client throws when the socket proxy is down. */
export const unreachable = () => new DockerUnreachableError("connect ECONNREFUSED /run/docker-api/docker.sock", "ECONNREFUSED");

export class FakeDocker {
  containers = new Map<string, FakeContainer>();
  calls: string[] = [];
  /** Behaviour of containers created through `createContainer`. */
  newContainerPlan: Plan = "healthy";
  /** Behaviour of every container that existed before the update (restart after stop). */
  restartPlan: Plan = "healthy";
  pullError: Error | null = null;
  /** "hang" keeps the pull open until its abort signal fires. */
  pullBehaviour: "instant" | "hang" = "instant";
  /** Runs while the pull is in flight, e.g. to withdraw the request. */
  onPull: () => void | Promise<void> = () => {};
  pullSignals: Array<AbortSignal | undefined> = [];
  /** Runs after a container started, e.g. to simulate a migration touching the database. */
  onStart: (container: FakeContainer) => void | Promise<void> = () => {};
  private failures: Array<{ call: string; when: (args: any[]) => boolean; error: Error }> = [];
  private plans = new Map<string, { plan: Plan; inspections: number }>();
  private created = 0;
  private starts = 0;

  add(container: FakeContainer): FakeContainer {
    this.containers.set(container.Id, container);
    return container;
  }

  failOn(call: string, error: Error, when: (args: any[]) => boolean = () => true) {
    this.failures.push({ call, when, error });
  }

  find(nameOrId: string): FakeContainer | undefined {
    return [...this.containers.values()].find((c) => c.Id === nameOrId || c.Name === `/${nameOrId}`);
  }

  byName(name: string): FakeContainer | undefined {
    return this.find(name);
  }

  callsTo(method: string): string[] {
    return this.calls.filter((call) => call === method || call.startsWith(`${method} `));
  }

  private record(call: string, ...args: any[]) {
    this.calls.push([call, ...args.map((a) => (typeof a === "string" ? a : JSON.stringify(a)))].join(" "));
    const failure = this.failures.find((f) => f.call === call && f.when(args));
    if (failure) throw failure.error;
  }

  private require(nameOrId: string): FakeContainer {
    const container = this.find(nameOrId);
    if (!container) throw notFound(nameOrId);
    return container;
  }

  async ping() {
    this.record("ping");
  }

  async inspectContainer(nameOrId: string) {
    const container = this.require(nameOrId);
    const behaviour = this.plans.get(container.Id);
    if (behaviour && container.State.Running) {
      behaviour.inspections += 1;
      const becomesHealthy = ["healthy", "crashes-after-healthy", "restarted-after-healthy"].includes(behaviour.plan);
      if (becomesHealthy && behaviour.inspections === 2) container.State.Health = { Status: "healthy" };
      if (behaviour.plan === "crashes-after-healthy" && behaviour.inspections >= 3) this.crash(container, behaviour.inspections);
      if (behaviour.plan === "restarted-after-healthy" && behaviour.inspections === 3) this.restartInPlace(container, "healthy");
      if (behaviour.plan === "unhealthy" && behaviour.inspections >= 2) container.State.Health = { Status: "unhealthy" };
      if (behaviour.plan === "exits" && behaviour.inspections >= 2) {
        container.State.Running = false;
        container.State.ExitCode = 1;
      }
    }
    return structuredClone(container);
  }

  /** The main process died: seen first as restarting, then as a fresh instance whose health check starts over. */
  private crash(container: FakeContainer, inspection: number) {
    if (!RESTARTING_POLICIES.has(container.HostConfig.RestartPolicy?.Name)) {
      container.State = { ...container.State, Running: false, ExitCode: 137 };
    } else if (inspection === 3) {
      container.State = { ...container.State, Restarting: true, ExitCode: 137 };
    } else if (inspection === 4) {
      this.restartInPlace(container, "starting");
    }
  }

  private restartInPlace(container: FakeContainer, health: string) {
    container.RestartCount = (container.RestartCount ?? 0) + 1;
    container.State = { Running: true, Restarting: false, ExitCode: 0, StartedAt: `restart-${container.RestartCount}`, Health: { Status: health } };
  }

  async inspectImage(ref: string) {
    this.record("inspectImage", ref);
    if (this.missingImages.has(ref)) throw new DockerApiError(`No such image: ${ref}`, 404);
    return structuredClone(this.images[ref] ?? releaseImage(ref));
  }

  /** Images by reference; anything else is a published release whose version label matches its tag. */
  images: Record<string, any> = {};
  /** `repo:tag` references that are not on the host until they are pulled. */
  missingImages = new Set<string>();
  /** What `listImages` answers (`docker images`), per repository. */
  imageList: Array<{ Id: string; RepoTags?: string[]; RepoDigests?: string[]; Labels?: Record<string, string> }> = [];
  /** References `removeImage` answers 409 for, as Docker does for an image a container uses. */
  imagesInUse = new Set<string>();

  async listImages(repository: string) {
    this.record("listImages", repository);
    return structuredClone(
      this.imageList.filter((image) =>
        [...(image.RepoTags ?? []), ...(image.RepoDigests ?? [])].some((ref) => ref.startsWith(`${repository}:`) || ref.startsWith(`${repository}@`)),
      ),
    );
  }

  async removeImage(ref: string) {
    this.record("removeImage", ref);
    if (this.imagesInUse.has(ref)) throw new DockerApiError(`conflict: unable to remove repository reference "${ref}"`, 409);
    const image = this.imageList.find((entry) => entry.RepoTags?.includes(ref) || entry.RepoDigests?.includes(ref));
    if (!image) throw new DockerApiError(`No such image: ${ref}`, 404);
    image.RepoTags = (image.RepoTags ?? []).filter((tag) => tag !== ref);
    image.RepoDigests = (image.RepoDigests ?? []).filter((digest) => digest !== ref);
    if (image.RepoTags.length === 0) this.imageList = this.imageList.filter((entry) => entry !== image);
  }

  async listContainers(label: string) {
    const [key, value] = label.split("=");
    return [...this.containers.values()]
      .filter((c) => c.Config.Labels?.[key] === value)
      .map((c) => ({ Id: c.Id, Names: [c.Name] }));
  }

  async pullImage(repo: string, tag: string, options: { signal?: AbortSignal } = {}) {
    this.record("pull", `${repo}:${tag}`);
    this.missingImages.delete(`${repo}:${tag}`);
    this.pullSignals.push(options.signal);
    await this.onPull();
    if (this.pullBehaviour === "hang") {
      await new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (this.pullError) throw this.pullError;
  }

  async stopContainer(nameOrId: string, timeoutSec: number) {
    this.record("stop", this.require(nameOrId).Name.slice(1), timeoutSec);
    this.require(nameOrId).State.Running = false;
  }

  async startContainer(nameOrId: string) {
    const container = this.require(nameOrId);
    this.record("start", container.Name.slice(1));
    this.starts += 1;
    container.State = { Running: true, Restarting: false, ExitCode: 0, StartedAt: `start-${this.starts}`, Health: { Status: "starting" } };
    container.RestartCount = 0;
    const isNew = container.Id.startsWith("new-");
    this.plans.set(container.Id, { plan: isNew ? this.newContainerPlan : this.restartPlan, inspections: 0 });
    await this.onStart(container);
  }

  async updateContainer(nameOrId: string, settings: Record<string, any>) {
    const container = this.require(nameOrId);
    this.record("update", container.Name.slice(1), settings);
    Object.assign(container.HostConfig, settings);
  }

  async renameContainer(nameOrId: string, name: string) {
    const container = this.require(nameOrId);
    this.record("rename", container.Name.slice(1), name);
    if (this.find(name)) throw new DockerApiError(`Conflict. The container name "/${name}" is already in use`, 409);
    container.Name = `/${name}`;
  }

  async createContainer(name: string, spec: Record<string, any>) {
    this.record("create", name);
    if (this.find(name)) throw new DockerApiError(`Conflict. The container name "/${name}" is already in use`, 409);
    const { HostConfig, NetworkingConfig, ...Config } = spec;
    this.created += 1;
    const container = this.add({
      Id: `new-${this.created}`,
      Name: `/${name}`,
      // Docker resolves the reference to the image id it points at.
      Image: Config.Image.startsWith("sha256:") ? Config.Image : (this.images[Config.Image] ?? releaseImage(Config.Image)).Id,
      Config,
      HostConfig,
      NetworkSettings: { Networks: { ...(NetworkingConfig?.EndpointsConfig ?? {}) } },
      Mounts: [],
      State: { Running: false, Restarting: false, ExitCode: 0 },
      RestartCount: 0,
    });
    return { Id: container.Id };
  }

  async connectNetwork(network: string, nameOrId: string, endpointConfig: Record<string, any>) {
    this.record("connect", network, this.require(nameOrId).Name.slice(1));
    this.require(nameOrId).NetworkSettings.Networks[network] = endpointConfig;
  }

  async removeContainer(nameOrId: string, options: { force?: boolean } = {}) {
    const container = this.require(nameOrId);
    this.record("remove", container.Name.slice(1), options);
    this.containers.delete(container.Id);
  }

  asClient(): DockerClient {
    return this as unknown as DockerClient;
  }
}

/** `inspectImage` of a release image pulled as `repo:tag`. */
function releaseImage(ref: string) {
  const tag = ref.slice(ref.lastIndexOf(":") + 1);
  return {
    Id: `sha256:id-of-${ref}`,
    RepoDigests: [`${IMAGE_REPO}@sha256:digest-of-${ref}`],
    Config: { Labels: { "org.opencontainers.image.version": tag } },
  };
}

/** A Servio container as `docker compose` creates it, running the old version. */
export function servioContainer(
  overrides: Partial<FakeContainer> & { databaseUrl?: string } = {},
): FakeContainer {
  const { databaseUrl = "file:/data/servio.db", ...rest } = overrides;
  return {
    Id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    Name: `/${CONTAINER_NAME}`,
    Image: "sha256:oldimage",
    Config: {
      Hostname: "0123456789ab",
      Image: `${IMAGE_REPO}:${OLD_VERSION}`,
      Env: ["PATH=/usr/bin", "PORT=3000", "AUTH_SECRET=s3cret", `DATABASE_URL=${databaseUrl}`],
      Cmd: ["pnpm", "start"],
      Entrypoint: ["/app/docker/entrypoint.sh"],
      Labels: {
        "servio.updater.managed": "true",
        "org.opencontainers.image.version": OLD_VERSION,
        "com.docker.compose.service": "web",
      },
    },
    HostConfig: { Binds: ["servio_servio-data:/data"], NetworkMode: "servio_default", RestartPolicy: { Name: "unless-stopped" } },
    NetworkSettings: {
      Networks: {
        servio_default: { Aliases: ["servio-web-1", "web", "0123456789ab"], NetworkID: "net1", IPAddress: "172.18.0.3" },
      },
    },
    Mounts: [{ Type: "volume", Name: "servio_servio-data", Destination: "/data", RW: true }],
    State: { Running: true, Restarting: false, ExitCode: 0, StartedAt: "2026-11-01T08:00:00Z", Health: { Status: "healthy" } },
    RestartCount: 0,
    ...rest,
  };
}

/** A request that is fresh relative to the harness clock (10:00:00Z). */
export const FRESH_REQUESTED_AT = "2026-11-06T09:59:00Z";

/**
 * Wraps the fake so that one call "kills the updater": the call never returns,
 * so the flow stops exactly there. `before` kills it ahead of the call's effect,
 * `after` once the effect happened but before the flow saw the result.
 */
export function killOn(
  docker: FakeDocker,
  method: string,
  when: "before" | "after",
  matches: (args: any[]) => boolean = () => true,
): { client: DockerClient; reached: Promise<void> } {
  let reachedKill: () => void = () => {};
  const reached = new Promise<void>((resolve) => (reachedKill = resolve));
  const client = new Proxy(docker, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown;
      if (typeof value !== "function") return value;
      if (property !== method) return value.bind(target);
      return async (...args: any[]) => {
        if (!matches(args)) return value.apply(target, args);
        if (when === "after") await value.apply(target, args);
        reachedKill();
        return new Promise(() => {});
      };
    },
  }) as unknown as DockerClient;
  return { client, reached };
}

export interface Harness {
  root: string;
  docker: FakeDocker;
  flow: ReturnType<typeof createUpdateFlow>;
  config: ReturnType<typeof loadConfig>;
  dbFile: string;
  backupDir: string;
  /** Database backup files in the backup directory (not the journal, ledger or liveness stamp). */
  backupFiles(): Promise<string[]>;
  logLines: string[];
  writeRequest(request: Record<string, unknown>): Promise<void>;
  readStatus(): Promise<any>;
  stateDir: string;
  newFlow(docker?: DockerClient): ReturnType<typeof createUpdateFlow>;
  clock: { now: () => number; sleep: (ms: number) => Promise<void>; timeoutSignal: () => AbortSignal };
  /** Fires the pull deadline signal. */
  expirePullDeadline(): void;
  /** Milliseconds the fake clock advanced (health polling sleeps). */
  elapsedMs(): number;
  /** A managed Servio container whose DATABASE_URL points at this harness's database. */
  container(overrides?: Partial<FakeContainer>): FakeContainer;
  cleanup(): Promise<void>;
}

export async function createHarness(
  options: { env?: Record<string, string>; databaseUrl?: string; freeBytes?: number } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "servio-updater-"));
  const stateDir = join(root, "state");
  const dbFile = join(root, "data", "servio.db");
  const backupDir = join(root, "backups");
  await mkdir(join(stateDir, "updater"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(dbFile, OLD_DB);
  await writeFile(`${dbFile}-wal`, OLD_WAL);
  await mkdir(backupDir);

  const config = loadConfig({
    SERVIO_IMAGE: IMAGE_REPO,
    SERVIO_CONTAINER: CONTAINER_NAME,
    SERVIO_STATE_DIR: stateDir,
    DB_FILE: dbFile,
    BACKUP_DIR: backupDir,
    HEALTH_TIMEOUT_SECONDS: "30",
    ...options.env,
  });

  const docker = new FakeDocker();
  const container = (overrides: Partial<FakeContainer> = {}) =>
    servioContainer({ databaseUrl: options.databaseUrl ?? `file:${dbFile}`, ...overrides });
  docker.add(container());
  docker.images["sha256:oldimage"] = {
    Id: "sha256:oldimage",
    Config: {
      Env: ["PATH=/usr/bin", "PORT=3000"],
      Cmd: ["pnpm", "start"],
      Entrypoint: ["/app/docker/entrypoint.sh"],
      Labels: { "org.opencontainers.image.version": OLD_VERSION },
    },
  };

  const start = Date.parse("2026-11-06T10:00:00Z");
  let time = start;
  const pullDeadline = new AbortController();
  const clock = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    timeoutSignal: () => pullDeadline.signal,
  };
  const logLines: string[] = [];
  const newFlow = (client: DockerClient = docker.asClient()) =>
    createUpdateFlow({
      docker: client,
      config,
      clock,
      log: (line) => logLines.push(line),
      ...(options.freeBytes === undefined ? {} : { freeBytes: async () => options.freeBytes as number }),
    });

  return {
    root,
    docker,
    flow: newFlow(),
    config,
    dbFile,
    backupDir,
    backupFiles: async () => (await readdir(backupDir)).filter((name) => name.startsWith("servio-")).sort(),
    logLines,
    writeRequest: (request) => writeFile(join(stateDir, "updater", "request.json"), JSON.stringify(request)),
    readStatus: async () => JSON.parse(await readFile(join(stateDir, "updater", "status.json"), "utf8")),
    stateDir,
    newFlow,
    clock,
    expirePullDeadline: () => pullDeadline.abort(new Error("deadline")),
    elapsedMs: () => time - start,
    container,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

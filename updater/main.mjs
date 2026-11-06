// Entry point: process wiring only (configuration, Docker client, signals); the
// lifecycle lives in service.mjs. On SIGTERM/SIGINT the loops stop; an update in
// progress is allowed to finish (give the container a long `stop_grace_period`).
import { loadConfig } from "./config.mjs";
import { createDockerClient } from "./docker-client.mjs";
import { runUpdater } from "./service.mjs";

const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop.abort());

try {
  const config = loadConfig();
  const docker = createDockerClient({ ...config.dockerEndpoint, apiVersion: config.apiVersion, registryAuth: config.registryAuth });
  await runUpdater({ config, docker, signal: stop.signal });
} catch (error) {
  console.error("[updater] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
}

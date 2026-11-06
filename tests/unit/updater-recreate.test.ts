import { describe, expect, it } from "vitest";
import { buildCreateSpec } from "../../updater/recreate.mjs";
import { IMAGE_REPO, NEW_VERSION, servioContainer } from "./updater-test-kit";

const NEW_REF = `${IMAGE_REPO}:${NEW_VERSION}`;
const SHORT_ID = "0123456789ab";

const oldImage = (config: Record<string, unknown> = {}) => ({
  Config: {
    Env: ["PATH=/usr/bin", "PORT=3000"],
    Cmd: ["pnpm", "start"],
    Entrypoint: ["/app/docker/entrypoint.sh"],
    Healthcheck: { Test: ["CMD", "node", "-e", "probe"], Interval: 30_000_000_000 },
    User: "node",
    Labels: { "org.opencontainers.image.version": "0.2.0", "org.opencontainers.image.source": "https://example.test" },
    ...config,
  },
});

/** The container as Docker reports it: image defaults merged with the user's settings. */
const containerWith = (config: Record<string, unknown> = {}) => {
  const container = servioContainer();
  container.Config = {
    ...container.Config,
    Healthcheck: { Test: ["CMD", "node", "-e", "probe"], Interval: 30_000_000_000 },
    User: "node",
    Labels: {
      ...container.Config.Labels,
      "org.opencontainers.image.source": "https://example.test",
    },
    ...config,
  };
  return container;
};

describe("buildCreateSpec: image-derived settings", () => {
  it("keeps only user-supplied env entries and lets the new image's defaults win", () => {
    const { body } = buildCreateSpec(containerWith(), oldImage(), NEW_REF);

    expect(body.Env).toEqual(["AUTH_SECRET=s3cret", "DATABASE_URL=file:/data/servio.db"]);
    expect(body.Image).toBe(NEW_REF);
  });

  it("keeps an env entry whose value differs from the image default", () => {
    const container = containerWith({ Env: ["PATH=/usr/bin", "PORT=4000"] });

    expect(buildCreateSpec(container, oldImage(), NEW_REF).body.Env).toEqual(["PORT=4000"]);
  });

  it("drops the env list entirely when nothing is user-supplied", () => {
    const container = containerWith({ Env: ["PATH=/usr/bin", "PORT=3000"] });

    expect(buildCreateSpec(container, oldImage(), NEW_REF).body).not.toHaveProperty("Env");
  });

  it("keeps compose labels and drops labels the old image provided", () => {
    const { body } = buildCreateSpec(containerWith(), oldImage(), NEW_REF);

    expect(body.Labels).toEqual({
      "servio.updater.managed": "true",
      "com.docker.compose.service": "web",
    });
  });

  it("keeps a label the user changed relative to the image", () => {
    const container = containerWith();
    container.Config.Labels["org.opencontainers.image.source"] = "https://fork.test";

    expect(buildCreateSpec(container, oldImage(), NEW_REF).body.Labels).toMatchObject({
      "org.opencontainers.image.source": "https://fork.test",
    });
  });

  it("omits Cmd, Entrypoint, Healthcheck and User when they equal the old image's", () => {
    const { body } = buildCreateSpec(containerWith(), oldImage(), NEW_REF);

    for (const field of ["Cmd", "Entrypoint", "Healthcheck", "User"]) expect(body).not.toHaveProperty(field);
  });

  it("keeps Cmd, Entrypoint and Healthcheck that were overridden", () => {
    const override = {
      Cmd: ["node", "custom.js"],
      Entrypoint: ["/bin/sh", "-c"],
      Healthcheck: { Test: ["NONE"] },
    };
    const { body } = buildCreateSpec(containerWith(override), oldImage(), NEW_REF);

    expect(body).toMatchObject(override);
  });

  it("treats null and empty values as equal when diffing against the image", () => {
    const container = containerWith({ Cmd: [], Entrypoint: null });
    const image = oldImage({ Cmd: null, Entrypoint: undefined });

    const { body } = buildCreateSpec(container, image, NEW_REF);

    expect(body).not.toHaveProperty("Cmd");
    expect(body).not.toHaveProperty("Entrypoint");
  });

  it("drops the hostname Docker derived from the old container id but keeps a chosen one", () => {
    expect(buildCreateSpec(containerWith(), oldImage(), NEW_REF).body).not.toHaveProperty("Hostname");
    expect(buildCreateSpec(containerWith({ Hostname: "servio" }), oldImage(), NEW_REF).body.Hostname).toBe("servio");
  });

  it("does not mutate its inputs", () => {
    const container = containerWith();
    const image = oldImage();
    const before = structuredClone({ container, image });

    buildCreateSpec(container, image, NEW_REF);

    expect({ container, image }).toEqual(before);
  });
});

describe("buildCreateSpec: host config and volumes", () => {
  it("copies binds, restart policy and the rest of HostConfig", () => {
    const { body } = buildCreateSpec(containerWith(), oldImage(), NEW_REF);

    expect(body.HostConfig).toEqual({
      Binds: ["servio_servio-data:/data"],
      NetworkMode: "servio_default",
      RestartPolicy: { Name: "unless-stopped" },
    });
  });

  it("re-binds an anonymous volume that only appears in Mounts, so its data survives", () => {
    const container = containerWith();
    container.HostConfig.Binds = [];
    container.Mounts = [{ Type: "volume", Name: "9f8e7d6c5b4a", Destination: "/data", RW: true }];

    expect(buildCreateSpec(container, oldImage(), NEW_REF).body.HostConfig.Binds).toEqual(["9f8e7d6c5b4a:/data"]);
  });

  it("does not duplicate a volume that HostConfig already binds", () => {
    expect(buildCreateSpec(containerWith(), oldImage(), NEW_REF).body.HostConfig.Binds).toEqual([
      "servio_servio-data:/data",
    ]);
  });
});

describe("buildCreateSpec: networks", () => {
  it("attaches the NetworkMode network on create with its aliases, minus the old container's short id", () => {
    const { body, extraNetworks } = buildCreateSpec(containerWith(), oldImage(), NEW_REF);

    expect(body.NetworkingConfig).toEqual({
      EndpointsConfig: { servio_default: { Aliases: ["servio-web-1", "web"] } },
    });
    expect(extraNetworks).toEqual([]);
  });

  it("returns the remaining networks for connect, keeping aliases and static IPs but not runtime state", () => {
    const container = containerWith();
    container.NetworkSettings.Networks = {
      db_net: { Aliases: ["web", SHORT_ID], IPAddress: "10.0.0.9", NetworkID: "n2", EndpointID: "e2", MacAddress: "aa" },
      servio_default: { Aliases: ["web", SHORT_ID], IPAMConfig: { IPv4Address: "172.18.0.50" }, DriverOpts: { k: "v" } },
      other_net: { Aliases: null },
    };

    const { body, extraNetworks } = buildCreateSpec(container, oldImage(), NEW_REF);

    expect(Object.keys(body.NetworkingConfig.EndpointsConfig)).toEqual(["servio_default"]);
    expect(body.NetworkingConfig.EndpointsConfig.servio_default).toEqual({
      Aliases: ["web"],
      IPAMConfig: { IPv4Address: "172.18.0.50" },
      DriverOpts: { k: "v" },
    });
    expect(extraNetworks).toEqual([
      { name: "db_net", endpointConfig: { Aliases: ["web"] } },
      { name: "other_net", endpointConfig: {} },
    ]);
  });

  it("maps NetworkMode 'default' to the bridge network", () => {
    const container = containerWith();
    container.HostConfig.NetworkMode = "default";
    container.NetworkSettings.Networks = { custom: {}, bridge: { Aliases: null } };

    const { body, extraNetworks } = buildCreateSpec(container, oldImage(), NEW_REF);

    expect(Object.keys(body.NetworkingConfig.EndpointsConfig)).toEqual(["bridge"]);
    expect(extraNetworks.map((network) => network.name)).toEqual(["custom"]);
  });

  it("omits NetworkingConfig when the container has no networks", () => {
    const container = containerWith();
    container.NetworkSettings.Networks = {};

    expect(buildCreateSpec(container, oldImage(), NEW_REF).body).not.toHaveProperty("NetworkingConfig");
  });
});

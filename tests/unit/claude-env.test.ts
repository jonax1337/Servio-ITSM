import { describe, expect, it } from "vitest";
import { inheritedHostEnv } from "@/lib/claude-env";

describe("inheritedHostEnv", () => {
  it("passes on what a process needs to run, in any spelling", () => {
    const env = inheritedHostEnv({
      Path: "C:\\bin",
      SystemRoot: "C:\\Windows",
      ComSpec: "cmd.exe",
      HOME: "/home/servio",
      https_proxy: "http://proxy:3128",
      NODE_EXTRA_CA_CERTS: "/ca.pem",
    });
    expect(env).toEqual({
      Path: "C:\\bin",
      SystemRoot: "C:\\Windows",
      ComSpec: "cmd.exe",
      HOME: "/home/servio",
      https_proxy: "http://proxy:3128",
      NODE_EXTRA_CA_CERTS: "/ca.pem",
    });
  });

  it("keeps Servio's secrets and provider credentials out (nothing for ${VAR} expansion to leak)", () => {
    const env = inheritedHostEnv({
      PATH: "/usr/bin",
      DATABASE_URL: "postgres://u:p@db/servio",
      AUTH_SECRET: "s",
      SETTINGS_ENCRYPTION_KEY: "k",
      ANTHROPIC_API_KEY: "a",
      OPENAI_API_KEY: "o",
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      CLAUDE_CONFIG_DIR: "/home/op/.claude",
      NODE_OPTIONS: "--require evil.js",
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { configSchema, currentHost, defaultConfig, sameHost, type FlowConfig } from "../src/core/config.js";
import { FlowError } from "../src/core/errors.js";
import { FlowStore } from "../src/core/store.js";
import { main } from "../src/cli/main.js";
import { Clock, tempDir } from "./helpers.js";

const A = "claude:a";

function storeOn(host: { name: string }, claims: Partial<FlowConfig["claims"]> = {}) {
  const config = defaultConfig({ requireHandoff: false, claims: { home: null, transport: "local", ...claims } });
  const clock = new Clock();
  const store = FlowStore.open(":memory:", { config, now: clock.now, host: () => host.name });
  return { store, clock };
}

function refusal(fn: () => unknown): FlowError {
  try {
    fn();
  } catch (e) {
    if (e instanceof FlowError) return e;
    throw e;
  }
  throw new Error("expected a FlowError");
}

describe("claims config", () => {
  it("defaults to no claim home and the local transport", () => {
    expect(defaultConfig().claims).toEqual({ home: null, transport: "local" });
  });

  it("accepts a home and either transport", () => {
    expect(configSchema.parse({ claims: { home: "DESKTOP-1" } }).claims).toEqual({ home: "DESKTOP-1", transport: "local" });
    expect(configSchema.parse({ claims: { home: " pc ", transport: "mailbox" } }).claims).toEqual({ home: "pc", transport: "mailbox" });
  });

  it("rejects an empty home and an unknown transport", () => {
    expect(() => configSchema.parse({ claims: { home: "" } })).toThrow();
    expect(() => configSchema.parse({ claims: { home: "   " } })).toThrow();
    expect(() => configSchema.parse({ claims: { transport: "smtp" } })).toThrow();
  });
});

describe("host identity", () => {
  it("uses AGENT_FLOW_HOST when it is set, trimmed", () => {
    expect(currentHost({ AGENT_FLOW_HOST: "  Laptop-2 " })).toBe("Laptop-2");
  });

  it("falls back to os.hostname() when AGENT_FLOW_HOST is unset or blank", () => {
    expect(currentHost({})).toBe(os.hostname());
    expect(currentHost({ AGENT_FLOW_HOST: "  " })).toBe(os.hostname());
  });

  it("compares host names case-insensitively", () => {
    expect(sameHost("DESKTOP-ABC", "desktop-abc")).toBe(true);
    expect(sameHost("desktop-abc", "desktop-abd")).toBe(false);
  });
});

describe("claims.home guard", () => {
  it("allows claims anywhere when claims.home is unset", () => {
    const { store } = storeOn({ name: "anything" });
    const t = store.create({ title: "x", status: "ready" }, A);
    expect(store.claim(t.id, A).owner).toBe(A);
  });

  it("allows claims on the home host, whatever the case", () => {
    const { store } = storeOn({ name: "desktop-home" }, { home: "DESKTOP-HOME" });
    const t = store.create({ title: "x", status: "ready" }, A);
    expect(store.claim(t.id, A).owner).toBe(A);
  });

  it("refuses claim, claim --next and the claim transition on another host, naming the home", () => {
    const { store } = storeOn({ name: "laptop" }, { home: "DESKTOP-HOME" });
    const t = store.create({ title: "x", status: "ready" }, A);
    for (const attempt of [() => store.claim(t.id, A), () => store.claim(null, A), () => store.transition(t.id, "claim", A)]) {
      const err = refusal(attempt);
      expect(err.code).toBe("NOT_CLAIM_HOME");
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("DESKTOP-HOME");
      expect(err.message).toContain("laptop");
      expect(err.details).toEqual({ home: "DESKTOP-HOME", host: "laptop" });
    }
    // Nothing changed: the ticket is still ready and no claim event was written.
    expect(store.get(t.id).status).toBe("ready");
    expect(store.events({ ticketId: t.id }).map((e) => e.action)).not.toContain("ticket.claimed");
  });

  it("refuses with the mailbox transport too, until remote claims exist", () => {
    const { store } = storeOn({ name: "laptop" }, { home: "desktop-home", transport: "mailbox" });
    const t = store.create({ title: "x", status: "ready" }, A);
    expect(refusal(() => store.claim(t.id, A)).code).toBe("NOT_CLAIM_HOME");
  });

  it("leaves heartbeat and release working for a ticket already held", () => {
    const host = { name: "desktop-home" };
    const { store } = storeOn(host, { home: "desktop-home" });
    const t = store.create({ title: "x", status: "ready" }, A);
    store.claim(t.id, A);
    host.name = "laptop";
    expect(store.heartbeat(t.id, A, 60).owner).toBe(A);
    expect(store.transition(t.id, "release", A).status).toBe("ready");
  });
});

describe("claims.home through the CLI", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function af(cwd: string, args: string[], actor = "human:test") {
    let stdout = "";
    let stderr = "";
    const code = await main([...args, "-C", cwd, "--actor", actor], { stdout: (s) => (stdout += `${s}\n`), stderr: (s) => (stderr += `${s}\n`) });
    return { code, stdout, stderr };
  }

  it("claim on a non-home host exits 1 with an error naming the home; where shows both", async () => {
    const dir = tempDir("af-claims-");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    expect((await af(dir, ["init"])).code).toBe(0);
    expect((await af(dir, ["config", "set", "claims.home", "DESKTOP-HOME"])).code).toBe(0);
    const id = JSON.parse((await af(dir, ["create", "x", "--ready", "--json"])).stdout).id as string;

    vi.stubEnv("AGENT_FLOW_HOST", "laptop");
    const refused = await af(dir, ["claim", id, "--json"], A);
    expect(refused.code).toBe(1);
    const err = JSON.parse(refused.stdout).error;
    expect(err.code).toBe("NOT_CLAIM_HOME");
    expect(err.message).toContain("DESKTOP-HOME");
    const next = await af(dir, ["claim", "--next"], A);
    expect(next.code).toBe(1);
    expect(next.stderr + next.stdout).toContain("DESKTOP-HOME");
    const where = JSON.parse((await af(dir, ["where", "--json"])).stdout);
    expect(where).toMatchObject({ host: "laptop", claims_home: "DESKTOP-HOME" });

    vi.stubEnv("AGENT_FLOW_HOST", "desktop-home");
    expect((await af(dir, ["claim", id], A)).code).toBe(0);
  });
});

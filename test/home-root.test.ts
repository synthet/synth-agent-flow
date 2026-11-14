import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { FlowError } from "../src/core/errors.js";
import { resolveRoot } from "../src/core/paths.js";
import { initWorkspace } from "../src/core/workspace.js";
import { tempDir } from "./helpers.js";

/** A fake home whose `.agent-flow` holds only the user-level registry, like ~/.agent-flow on a dashboard machine. */
function fakeHome(withStrayTracker = false): string {
  const home = tempDir("af-home-");
  mkdirSync(path.join(home, ".agent-flow"), { recursive: true });
  writeFileSync(path.join(home, ".agent-flow", "workspaces.json"), JSON.stringify({ version: 1, workspaces: [] }));
  if (withStrayTracker) writeFileSync(path.join(home, ".agent-flow", "config.json"), "{}");
  return home;
}

function nonGitDir(...parts: string[]): string {
  const dir = path.join(...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("the home folder is not a tracker root", () => {
  it("resolveRoot from a non-git folder under home does not climb to the home registry", () => {
    const home = fakeHome();
    const tmp = nonGitDir(home, "AppData", "Local", "Temp", "af-x");
    expect(resolveRoot(tmp, { home })).toBe(path.resolve(tmp));
  });

  it("skips home even when a stray tracker was initialised there", () => {
    const home = fakeHome(true);
    const tmp = nonGitDir(home, "scratch", "a");
    expect(resolveRoot(tmp, { home })).toBe(path.resolve(tmp));
  });

  it("still finds a real tracker below home", () => {
    const home = fakeHome();
    const proj = nonGitDir(home, "notes");
    mkdirSync(path.join(proj, ".agent-flow"));
    expect(resolveRoot(nonGitDir(proj, "a", "b"), { home })).toBe(path.resolve(proj));
  });

  it("initWorkspace refuses the home folder unless allowHome is set", () => {
    const home = fakeHome();
    let err: unknown;
    try {
      initWorkspace(home, {}, { home });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FlowError);
    expect((err as FlowError).code).toBe("INVALID_ARGUMENT");
    expect(existsSync(path.join(home, ".agent-flow", "config.json"))).toBe(false);

    expect(initWorkspace(home, {}, { home, allowHome: true }).created).toBe(true);
    expect(existsSync(path.join(home, ".agent-flow", "config.json"))).toBe(true);
  });

  it("initWorkspace from a non-git folder under home initialises that folder, not home", () => {
    const home = fakeHome();
    const tmp = nonGitDir(home, "AppData", "Local", "Temp", "af-y");
    expect(initWorkspace(tmp, {}, { home }).paths.root).toBe(path.resolve(tmp));
    expect(existsSync(path.join(home, ".agent-flow", "config.json"))).toBe(false);
  });
});

describe("agent-flow init in the home folder", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ["HOME", "USERPROFILE", "AGENT_FLOW_REGISTRY", "AGENT_FLOW_HOME"];
  let home = "";
  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    home = fakeHome();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.AGENT_FLOW_REGISTRY = "off";
    delete process.env.AGENT_FLOW_HOME;
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const run = async (args: string[]) => {
    let out = "";
    let errText = "";
    const code = await main([...args, "--actor", "human:test"], { stdout: (s) => (out += `${s}\n`), stderr: (s) => (errText += `${s}\n`) });
    return { code, out, errText };
  };

  it("refuses without --allow-home and initialises with it", async () => {
    const refused = await run(["init", "-C", home]);
    expect(refused.code).toBe(1);
    expect(refused.errText).toMatch(/home folder/);
    expect(existsSync(path.join(home, ".agent-flow", "config.json"))).toBe(false);

    const allowed = await run(["init", "--allow-home", "-C", home]);
    expect(allowed.code).toBe(0);
    expect(existsSync(path.join(home, ".agent-flow", "config.json"))).toBe(true);
  });
});

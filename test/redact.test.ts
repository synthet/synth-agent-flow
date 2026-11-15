import { describe, expect, it } from "vitest";
import { scrubMachinePaths } from "../src/core/redact.js";
import { makeStore } from "./helpers.js";

const H = "human:dmn";
const MACHINE = /[A-Za-z]:[\\/]|\/(?:home|Users)\/|(?<![\w.~:-])\/[a-z]\/[\w.-]/;

describe("scrubMachinePaths", () => {
  it.each([
    ["in worktree D:\\Projects\\synthet-code-framework.worktrees\\scf-3ilvi. Left", "in worktree <path>. Left"],
    ["list -C D:/Projects/jev-mcp --all → jev-t4msd", "list -C <path> --all → jev-t4msd"],
    ["receipt C:\\Users\\alice\\.claude\\skills\\x\\SKILL.md ok", "receipt <path> ok"],
    ["escaped D:\\\\Projects\\\\synthet-agent-flow\\\\src in JSON", "escaped <path> in JSON"],
    ["git bash /d/Projects/synthet-agent-flow/bin then", "git bash <path> then"],
    ["home /home/alice/work and /Users/alice/src/x.ts", "home <path> and <path>"],
    ["(see `D:\\Projects\\x`)", "(see `<path>`)"],
  ])("replaces %j", (input, expected) => {
    expect(scrubMachinePaths(input)).toBe(expected);
  });

  it.each([
    // Segments with spaces (af-iil8q): continuation words are capitalised or numeric and end in a separator.
    ["at D:\\Program Files\\Git\\bin now", "at <path> now"],
    ["home C:\\Users\\First Last\\proj\\x.ts:12 ok", "home <path> ok"],
    ["fwd C:/Users/First Last/src end", "fwd <path> end"],
    ["mount /c/Program Files/Git/api/stream here", "mount <path> here"],
    ["in D:\\New Folder 2\\x done", "in <path> done"],
    // WSL, UNC and /root.
    ["wsl /mnt/c/Users/alice/x and /mnt/d/Projects", "wsl <path> and <path>"],
    ["share \\\\server\\share\\dir\\f.txt copied", "share <path> copied"],
    ["key /root/.ssh/config", "key <path>"],
  ])("replaces %j (spaces, WSL, UNC, /root)", (input, expected) => {
    expect(scrubMachinePaths(input)).toBe(expected);
  });

  it.each([
    // A spaced last segment before a closing delimiter or the end (review of af-iil8q).
    ['"C:\\Users\\First Last"', '"<path>"'],
    ["`C:\\Users\\First Last`", "`<path>`"],
    ["'C:\\Users\\First Last'", "'<path>'"],
    ['cd "C:\\Users\\First Last"', 'cd "<path>"'],
    ["PS C:\\Users\\First Last> dir", "PS <path>> dir"],
    ['{"t":"C:\\\\Users\\\\First Last"}', '{"t":"<path>"}'],
    ["home is C:\\Users\\First Last", "home is <path>"],
    ["x86 C:\\Program Files (x86)\\Tool\\a.exe run", "x86 <path> run"],
    // Lower-case Git Bash users/home folders.
    ["bash /c/users/alice/x ok", "bash <path> ok"],
    ["bash /d/home/bob/.ssh ok", "bash <path> ok"],
  ])("replaces %j (closing delimiters, x86, lower-case mounts)", (input, expected) => {
    expect(scrubMachinePaths(input)).toBe(expected);
  });

  it.each([
    ["see D:\\x for and/or more", "see <path> for and/or more"],
    ["D:/Projects/workspace map", "<path> map"],
    // A backslash path continues only across backslashes, so slash-words after it stay prose.
    ["at D:\\x 3/4 done", "at <path> 3/4 done"],
    ["D:\\x A/B testing", "<path> A/B testing"],
    ["see D:\\x Then/Now ok", "see <path> Then/Now ok"],
    ["ran C:\\x I/O bound", "ran <path> I/O bound"],
  ])("stops a path at prose: %j", (input, expected) => {
    expect(scrubMachinePaths(input)).toBe(expected);
  });

  it.each([
    "pick a/b or /a/b and 3/4, and/or",
    "/tmp/x and /var/log/syslog",
    "the /c/ switch and /d/x in prose",
    "the /I/O path",
    "regex \\\\s\\S here and use \\\\w\\d",
    "escaped relative .\\\\src\\x stays",
    "src/core/store.ts:120 and docs/specs/software-factory/tasks.md#T-1",
    "https://github.com/synthet/synthet-agent-flow/pull/26",
    "~/.claude/skills/next-steps and ~/.agents/skills",
    "AC-1: works; deps T-3>T-2; and/or; C: drive is full",
    "file:///not-a-drive and ./scripts/x.py",
  ])("leaves %j untouched", (input) => {
    expect(scrubMachinePaths(input)).toBe(input);
  });
});

describe("scrubMachinePaths performance", () => {
  it("stays linear on long runs of capitalised words (no catastrophic backtracking)", () => {
    const bs = "\\";
    const inputs = [
      `C:${bs}Users${bs}${"Word ".repeat(50000)}`,
      `C:${bs}U ${"Ab Cd ".repeat(20000)}Ef${bs}g`,
      `/c/P${" A/".repeat(30000)}`,
    ];
    const start = Date.now();
    for (const text of inputs) scrubMachinePaths(text);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("snapshot export", () => {
  it("scrubs machine paths from free text but keeps the database text", () => {
    const { store } = makeStore();
    const t = store.create(
      { title: "Fix D:\\Projects\\x", body: "Context: D:/Projects/workspace map, src/core/a.ts", acceptance: ["Runs from C:\\Users\\alice\\repo"] },
      H,
    );
    store.comment(t.id, "handoff", "Worktree D:\\Projects\\fw.worktrees\\scf-3ilvi; branch af/x", H);
    store.verifyAcceptance(t.id, "AC-1", "Verified", "list -C D:/Projects/jev-mcp --all; /home/alice/x", H);

    const snapshot = store.exportSnapshot();
    expect(snapshot).not.toMatch(MACHINE);
    const row = JSON.parse(snapshot.trim()) as { title: string; body: string; acceptance: Array<{ text: string; evidence: string }>; comments: Array<{ body: string }> };
    expect(row.title).toBe("Fix <path>");
    expect(row.body).toBe("Context: <path> map, src/core/a.ts");
    expect(row.acceptance[0]).toMatchObject({ text: "Runs from <path>", evidence: "list -C <path> --all; <path>" });
    expect(row.comments[0].body).toBe("Worktree <path>; branch af/x");

    const d = store.detail(t.id);
    expect(d.body).toContain("D:/Projects/workspace");
    expect(d.comments[0].body).toContain("D:\\Projects\\fw.worktrees");
    expect(d.acceptance[0].evidence).toContain("D:/Projects/jev-mcp");
  });

  it("re-importing the scrubbed snapshot does not overwrite the database text", () => {
    const { store } = makeStore();
    const t = store.create({ title: "T", body: "at D:\\Projects\\x" }, H);
    store.comment(t.id, "note", "see D:/Projects/y", H);
    expect(store.importSnapshot(store.exportSnapshot(), "system:test")).toEqual({ inserted: 0, updated: 0, skipped: 1 });
    expect(store.detail(t.id).body).toBe("at D:\\Projects\\x");
    expect(store.detail(t.id).comments[0].body).toBe("see D:/Projects/y");
  });
});

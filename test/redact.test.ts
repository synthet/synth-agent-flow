import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
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
    // Line breaks, sentence punctuation and table cells close a spaced path too (second review of af-iil8q).
    ["cd C:\\Users\\First Last\nnext", "cd <path>\nnext"],
    ["cd C:\\Users\\First Last\r\nnext", "cd <path>\r\nnext"],
    ["- D:\\Program Files\n- item", "- <path>\n- item"],
    ["/home/First Last\nx", "<path>\nx"],
    ["See C:\\Users\\First Last, then", "See <path>, then"],
    ["See C:\\Users\\First Last; then", "See <path>; then"],
    ["See C:\\Users\\First Last: then", "See <path>: then"],
    ["Is it C:\\Users\\First Last? yes", "Is it <path>? yes"],
    ["at C:\\Users\\First Last. Next we ran", "at <path>. Next we ran"],
    ["| C:\\Users\\First Last | note |", "| <path> | note |"],
    // The folder after Users/home is a username: capitalised words after it belong to it, whatever follows.
    ["C:\\Users\\First Last and then", "<path> and then"],
    ['"C:\\Users\\First Last "', '"<path> "'],
    ["C:\\users\\Anne Marie Smith ran it", "<path> ran it"],
    ["/home/First Last and more", "<path> and more"],
    ["/Users/First Last is the mac home", "<path> is the mac home"],
    ["bash /c/users/First Last/x ok", "bash <path> ok"],
    ["wsl /mnt/c/Users/First Last and on", "wsl <path> and on"],
    ['{"p":"C:\\\\Users\\\\First Last and"}', '{"p":"<path> and"}'],
    // Upper-case Git Bash drive letters.
    ["bash /C/Users/alice/x ok", "bash <path> ok"],
    ["bash /C/home/bob ok", "bash <path> ok"],
    ["bash /D/Projects/x ok", "bash <path> ok"],
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
    "an /A/B testing note",
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

describe("scrubMachinePaths: the exporting machine's own home folder (exact)", () => {
  const homes = ["C:\\Users\\admin 01x"]; // deliberately lower-case and spaced: the heuristics alone would leak it
  it.each([
    ["at C:\\Users\\admin 01x\\proj\\x.ts ok", "at <path> ok"],
    ["fwd C:/Users/admin 01x/proj ok", "fwd <path> ok"],
    ['{"p":"C:\\\\Users\\\\admin 01x\\\\proj"}', '{"p":"<path>"}'],
    ["bash /c/Users/admin 01x/proj ok", "bash <path> ok"],
    ["wsl /mnt/c/Users/admin 01x/proj ok", "wsl <path> ok"],
    ["case c:\\users\\ADMIN 01X\\x ok", "case <path> ok"],
    ["bare C:\\Users\\admin 01x then", "bare <path> then"],
  ])("replaces %j", (input, expected) => {
    expect(scrubMachinePaths(input, { homes })).toBe(expected);
  });

  it("leaves a longer sibling folder to the user-name patterns, which replace it whole", () => {
    expect(scrubMachinePaths("C:\\Users\\admin 01xyz\\a", { homes })).toBe("<path>");
  });
});

describe("scrubMachinePaths: exact home pass, review-4 fixes", () => {
  it.each([
    "C:\\Users\\jean-luc", "/home/first-last", "C:\\Users\\a.b", "C:\\Users\\a+b", "C:\\Users\\a(b)",
    "C:\\Users\\a[b]", "C:\\Users\\a$b", "C:\\Users\\a^b", "C:\\Users\\a{b}", "C:\\Users\\a|b", "C:\\Users\\a*b?",
  ])("never throws, and replaces the home %j", (home) => {
    const sep = home.startsWith("/") ? "/" : "\\";
    expect(() => scrubMachinePaths("plain text, no path", { homes: [home] })).not.toThrow();
    expect(scrubMachinePaths(`at ${home}${sep}x ok`, { homes: [home] })).toBe("at <path> ok");
  });

  it("survives a hyphenated home through the default (USERPROFILE/HOME) path", () => {
    const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
    process.env.USERPROFILE = "C:\\Users\\jean-luc";
    process.env.HOME = "/home/jean-luc";
    try {
      expect(scrubMachinePaths("plain text, no path")).toBe("plain text, no path");
      expect(scrubMachinePaths("at C:\\Users\\jean-luc\\x ok")).toBe("at <path> ok");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  // The home is a prefix of a longer user name or folder: the exact pass steps aside and the user-name patterns
  // replace the whole thing.
  const prefix = { homes: ["C:\\Users\\First"] };
  it.each([
    ["C:\\Users\\First Last\\x ok", "<path> ok"],
    ['"C:\\Users\\First Last"', '"<path>"'],
    ["C:/Users/First Last/x ok", "<path> ok"],
    ["/c/Users/First Last/x ok", "<path> ok"],
    ["C:\\Users\\First 2\\x ok", "<path> ok"],
    ["C:\\Users\\First2\\a ok", "<path> ok"],
    ["C:\\Users\\First-old\\a ok", "<path> ok"],
    ["C:\\Users\\First.old\\a ok", "<path> ok"],
    ["C:\\Users\\First\\a ok", "<path> ok"],
    ["home C:\\Users\\First. Next", "home <path>. Next"],
    ["see C:\\Users\\First, then", "see <path>, then"],
  ])("with home C:\\Users\\First: %j", (input, expected) => {
    expect(scrubMachinePaths(input, prefix)).toBe(expected);
  });

  // A lower-case home: the heuristics alone would stop at the lower-case word, so the exact pass takes siblings.
  const lower = { homes: ["C:\\Users\\first last"] };
  it.each([
    ["C:\\Users\\first last2\\x ok", "<path> ok"],
    ["C:\\Users\\first last-old\\x ok", "<path> ok"],
    ["C:\\Users\\first last_bak\\x ok", "<path> ok"],
    ["C:\\Users\\first last.old\\x ok", "<path> ok"],
    ["C:\\Users\\first last 2\\x ok", "<path> ok"],
    ["C:\\Users\\first lasté\\x ok", "<path> ok"],
    ["C:\\Users\\first last. Next", "<path>. Next"],
    ["xC:\\Users\\first last", "x<path>"],
    ["D:\\backupC:\\Users\\first last\\x", "<path><path>"],
  ])("with lower-case home C:\\Users\\first last: %j", (input, expected) => {
    expect(scrubMachinePaths(input, lower)).toBe(expected);
  });

  it("matches a POSIX home case-sensitively", () => {
    const posix = { homes: ["/Users/bob"] };
    expect(scrubMachinePaths("route /users/bob/posts here", posix)).toBe("route /users/bob/posts here");
    expect(scrubMachinePaths("at /Users/bob/x ok", posix)).toBe("at <path> ok");
  });

  it("uses this machine's home folder by default", () => {
    const home = os.homedir();
    expect(scrubMachinePaths(`see ${home}${path.sep}notes.txt ok`)).toBe("see <path> ok");
  });
});

describe("scrubMachinePaths: review-3 fixes", () => {
  it.each([
    // 1. A number after a user name.
    ["C:\\Users\\Admin 01\\proj\\client-acme\\x ok", "<path> ok"],
    ["C:/Users/Admin 01/proj ok", "<path> ok"],
    ["/home/User 2/proj ok", "<path> ok"],
    // 2. Non-ASCII capitals and numbers.
    ["C:\\Users\\Ana Álvarez\\x ok", "<path> ok"],
    ["C:\\Users\\Søren Øster ran", "<path> ran"],
    ["/home/Łukasz Żółć/x ok", "<path> ok"],
    ["D:\\Ömer Özil\\Dokumente\\x ok", "<path> ok"],
    // Lower-case surname particles inside a user name.
    ["C:\\Users\\Jan van der Berg\\x ok", "<path> ok"],
    ["/home/Ludwig von Mises ran", "<path> ran"],
    ["C:\\Users\\Maria de la Cruz and more", "<path> and more"],
    // 3. Initials in a user name.
    ["C:\\Users\\J. R. Smith\\x ok", "<path> ok"],
    ["C:\\Users\\J.R. Smith\\x ok", "<path> ok"],
  ])("replaces %j", (input, expected) => {
    expect(scrubMachinePaths(input)).toBe(expected);
  });

  it.each([
    // 4. API routes are not paths.
    "GET /users/42/posts",
    "route /users/:id and /home",
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

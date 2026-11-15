/**
 * Machine-path scrubbing for the committed snapshot.
 *
 * `tickets.jsonl` is committed, often to public repositories, but agents write absolute paths into
 * comments and acceptance evidence (`D:\Projects\…`, `C:/Users/<name>/…`, `/home/<name>/…`). The database
 * keeps the original text; only the exported copy is scrubbed. Repo-relative paths, `~/` paths and URLs
 * are left alone.
 *
 * Two passes:
 * 1. **Exact.** The exporting machine's own home folder (`os.homedir()`, `USERPROFILE`, `HOME`) is replaced in
 *    every form an agent writes it: back or forward slashes, JSON-escaped, Git Bash `/c/…` and WSL `/mnt/c/…`,
 *    case-insensitively, plus whatever path follows it. That is the leak that matters most, and an exact
 *    match doesn't depend on how the name is spelled.
 * 2. **Heuristic** for every other path. Paths are free text here, so this is not a parser. Known limits:
 *    - A lower-case word after a space ends the path: `D:\Work\first last\x` keeps `last\x`.
 *    - A tab, a double space or an apostrophe (`O'Brien`) inside a path ends it too.
 *    - Outside a user folder, a trailing space before a closing quote ends the path early: `"D:\Program Files "`
 *      keeps `Files`. Closing on every space-then-quote would swallow too much of the prose that follows paths.
 *      User folders (`Users\<name>`, `home/<name>`) take every word after the name that starts with an upper-case
 *      letter or a digit (any script), including initials (`J. R. Smith`) and lower-case surname particles
 *      followed by a capitalised word (`Jan van der Berg`, `Maria de la Cruz`).
 *    - It errs toward hiding: capitalised words right before a closing quote, a line break, sentence punctuation or
 *      the end of the text are taken as part of the path (`see D:\x Then, we` → `see <path>, we`), and so are
 *      `Capitalised/Words` after a forward-slash path (`D:/x A/B testing` → `<path> testing`). Doubled-backslash
 *      regex text with a word after it (`\\bword\b`) can be taken for a UNC path.
 *    - Git Bash mounts with a lower-case folder are scrubbed only for `users` and `home` (`/d/projects` stays). A
 *      bare lower-case `/users/…` with no drive is left alone, because it is usually an API route.
 *    - A doubly-escaped UNC path (`\\\\server\\share` as text) is not recognised.
 */
import os from "node:os";

/** Characters that end a path run. */
const STOP = String.raw`\s"'\x60<>|()\[\]{},;`;
/** One path run without spaces. */
const SEG = String.raw`[^${STOP}]*`;
/** The first character of a word that may follow a space inside a path: an upper-case letter or a digit, any script. */
const CAP = String.raw`[\p{Lu}\p{N}]`;
/** A word that may follow a space inside a path (`Program`, `Last`, `2`, `Øster`), or the `(x86)` of `Program Files (x86)`. */
const WORD = String.raw`(?:${CAP}[^${STOP}\\/]*|\(x86\))`;
/**
 * What may close a path whose last folder has a space in it: a quote, backtick, `>`, closing bracket, a line
 * break, sentence punctuation followed by a space or the end (`First Last, then`), a table pipe (`First Last |`),
 * or the end of the text.
 */
const CLOSE = String.raw`(?=["'\x60>\])}\r\n]|[.,:;!?]+(?:\s|$)| \||$)`;
/**
 * A path body whose continuations use separator `sep`. A space continues the path only when the following words
 * start with an upper-case letter or a digit and the last one either ends in the same separator the path uses or
 * closes the path (see CLOSE). A space right after sentence punctuation ends the path, so `…\scf-3ilvi. Left`
 * keeps `Left`.
 */
const body = (sep: string) => String.raw`${SEG}(?:(?<![.,:;!?]) (?:${WORD} )*${WORD}(?:${sep}${SEG}|${CLOSE}))*`;
const BS = body(String.raw`\\`);
const FS = body("/");
const ANY = body(String.raw`[\\/]`);
/** A space inside a user name may follow sentence punctuation only after a one-letter initial (`J.`, `J.R.`). */
const NAME_SPACE = String.raw`(?:(?<![.,:;!?])|(?<=(?<!\p{L})\p{Lu}\.)) `;
/**
 * The folder right after `Users` or `home` is a user name. Every word after it that starts with an upper-case
 * letter or a digit belongs to it, whatever follows, so `C:\Users\First Last and then` keeps no part of the name.
 */
const PARTICLES = String.raw`(?:van|von|der|den|de|da|di|du|del|della|la|le|ter|ten|bin|ibn|al)`;
const NAME = String.raw`[^${STOP}\\/]+(?:${NAME_SPACE}(?:${PARTICLES} )*${CAP}[^${STOP}\\/]*)*`;

const re = (source: string, flags = "gu") => new RegExp(source, flags);
const HEURISTIC: RegExp[] = [
  // User folders first. C:\Users\<name>\…, including JSON-escaped `\\`.
  re(String.raw`(?<![\p{L}\p{N}])[A-Za-z]:\\+[Uu]sers\\+${NAME}(?:\\+${BS})?`),
  // C:/Users/<name>/….
  re(String.raw`(?<![\p{L}\p{N}])[A-Za-z]:/+[Uu]sers/+${NAME}(?:/${FS})?`),
  // /mnt/c/Users/<name>, /c/users/<name>, /C/home/<name>: behind a drive mount, `users` may be lower case.
  re(String.raw`(?<![\w.~:/-])(?:/mnt)?/[A-Za-z]/(?:home|[Uu]sers)/${NAME}(?:/${FS})?`),
  // /home/<name> and macOS /Users/<name>. A bare lower-case /users/… is an API route, not a path.
  re(String.raw`(?<![\w.~:/-])/(?:home|Users)/${NAME}(?:/${FS})?`),
  // Windows drive paths with backslashes, including JSON-escaped `\\`.
  re(String.raw`(?<![\p{L}\p{N}])[A-Za-z]:\\${BS}`),
  // Windows drive paths with forward slashes. `https://` is not a drive.
  re(String.raw`(?<![\p{L}\p{N}])[A-Za-z]:/${FS}`),
  // UNC shares: \\server\share\…. A 2+ character server name keeps regex text like `\\s\S` untouched.
  re(String.raw`(?<![\w.\\/:])\\\\[A-Za-z0-9._$-]{2,}\\${BS}`),
  // Root's home.
  re(String.raw`(?<![\w.~:/-])/root/${FS}`),
  // WSL drive mounts: /mnt/c/….
  re(String.raw`(?<![\w.~:/-])/mnt/[A-Za-z]/${FS}`),
  // Other Git Bash / MSYS drive mounts such as /d/Projects/… or /D/Projects/…. A capitalised folder of two or more
  // characters keeps `/a/b`, `/I/O` and `/A/B` in prose untouched.
  re(String.raw`(?<![\w.~:/-])/[A-Za-z]/[A-Z][\w.-]${FS}`),
];

/** Every way an agent writes `home`: back or forward slashes, JSON-escaped, Git Bash and WSL mounts. */
function homeForms(home: string): string[] {
  let h = home.replace(/[\\/]+$/, "");
  const bash = /^\/([A-Za-z])\/(.*)$/.exec(h);
  if (bash && !/^\/(?:home|root|Users)\//.test(h)) h = `${bash[1]}:\\${bash[2].replace(/\//g, "\\")}`;
  const forms = new Set<string>([h, h.replace(/\//g, "\\"), h.replace(/\\/g, "/"), h.replace(/[\\/]/g, "\\\\")]);
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(h);
  if (drive) {
    const rest = drive[2].replace(/\\/g, "/");
    forms.add(`/${drive[1]}/${rest}`);
    forms.add(`/mnt/${drive[1]}/${rest}`);
  }
  // A home shorter than `/x/y` is too generic to replace exactly (`/`, `/root` is handled by the heuristics).
  return [...forms].filter((f) => f.length >= 6).sort((a, b) => b.length - a.length);
}

/**
 * Escape `s` for a regex and make only its letters case-insensitive (`[cC]:\\[uU]sers…`). Windows paths ignore
 * case, but the `i` flag would also make `\p{Lu}` in the path tail match lower-case prose.
 */
const literalNoCase = (s: string) =>
  [...s]
    .map((ch) => {
      const lo = ch.toLowerCase();
      const up = ch.toUpperCase();
      if (lo !== up) return `[${lo}${up}]`;
      return /[.*+?^${}()|[\]\\/-]/.test(ch) ? `\\${ch}` : ch;
    })
    .join("");
const exactCache = new Map<string, RegExp[]>();

function exactPatterns(homes: string[]): RegExp[] {
  const key = homes.join("\0");
  let pats = exactCache.get(key);
  if (!pats) {
    const forms = [...new Set(homes.flatMap(homeForms))].sort((a, b) => b.length - a.length);
    // The home, not followed by more of a folder name, then whatever path follows it.
    pats = forms.map((f) => re(String.raw`(?<![\p{L}\p{N}])${literalNoCase(f)}(?![\p{L}\p{N}_-])(?:[\\/]+${ANY})?`));
    exactCache.set(key, pats);
  }
  return pats;
}

function defaultHomes(): string[] {
  return [os.homedir(), process.env.USERPROFILE, process.env.HOME].filter((h): h is string => Boolean(h));
}

export const PATH_PLACEHOLDER = "<path>";

const placeholder = (match: string) => PATH_PLACEHOLDER + (/[.,:;!?]+$/.exec(match)?.[0] ?? "");

/**
 * Replace absolute machine paths in free text with `<path>`, keeping trailing sentence punctuation.
 * `homes` defaults to this machine's home folder; tests pass their own.
 */
export function scrubMachinePaths(text: string, opts: { homes?: string[] } = {}): string {
  let out = text;
  for (const p of [...exactPatterns(opts.homes ?? defaultHomes()), ...HEURISTIC]) out = out.replace(p, placeholder);
  return out;
}

/** `scrubMachinePaths` for nullable fields. */
export function scrubNullable(text: string | null | undefined): string | null {
  return text == null ? null : scrubMachinePaths(text);
}

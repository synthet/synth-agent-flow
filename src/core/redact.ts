/**
 * Machine-path scrubbing for the committed snapshot.
 *
 * `tickets.jsonl` is committed, often to public repositories, but agents write absolute paths into
 * comments and acceptance evidence (`D:\Projects\…`, `C:/Users/<name>/…`, `/home/<name>/…`). The database
 * keeps the original text; only the exported copy is scrubbed. Repo-relative paths, `~/` paths and URLs
 * are left alone.
 *
 * Paths are free text here, so this is a heuristic, not a parser. Known limits:
 * - A lower-case word after a space ends the path: `C:\Users\first last\x` keeps `last\x`.
 * - A tab, a double space or an apostrophe (`O'Brien`) inside a path ends it too.
 * - Outside a user folder, a trailing space before a closing quote ends the path early: `"D:\Program Files "`
 *   keeps `Files`. Closing on every space-then-quote would swallow too much of the prose that follows paths.
 *   User folders (`Users\<name>`, `home/<name>`) take every capitalised word after the name, so a user name is
 *   never split.
 * - It errs toward hiding: capitalised words right before a closing quote, a line break, sentence punctuation or
 *   the end of the text are taken as part of the path (`see D:\x Then, we` → `see <path>, we`), and so are
 *   `Capitalised/Words` after a forward-slash path (`D:/x A/B testing` → `<path> testing`). Doubled-backslash
 *   regex text with a word after it (`\\bword\b`) can be taken for a UNC path.
 * - Git Bash mounts with a lower-case folder are scrubbed only for `users` and `home` (`/d/projects` stays).
 * - A doubly-escaped UNC path (`\\\\server\\share` as text) is not recognised.
 */

/** One path run without spaces. */
const SEG = String.raw`[^\s"'\x60<>|()\[\]{},;]*`;
/**
 * A word that may follow a space inside a path: capitalised or numeric with no separators (`Program`, `Last`,
 * `2`), or the literal `(x86)` of `Program Files (x86)`.
 */
const WORD = String.raw`(?:[A-Z0-9][^\s"'\x60<>|()\[\]{},;\\/]*|\(x86\))`;
/**
 * What may close a path whose last folder has a space in it: a quote, backtick, `>`, closing bracket, a line
 * break, sentence punctuation followed by a space or the end (`First Last, then`), a table pipe (`First Last |`),
 * or the end of the text.
 */
const CLOSE = String.raw`(?=["'\x60>\])}\r\n]|[.,:;!?]+(?:\s|$)| \||$)`;
/**
 * A path body whose continuations use separator `sep`. A space continues the path only when the following words
 * are capitalised or numeric and the last one either ends in the same separator the path uses or closes the path
 * (see CLOSE). So `C:\Users\First Last\x`, `"C:\Users\First Last"` and `D:\Program Files (x86)\x` are replaced
 * whole, while `D:\x for and/or`, `D:\x A/B testing` and `D:/Projects/workspace map` stop at the prose.
 */
// A space right after sentence punctuation ends the path: `…\scf-3ilvi. Left` keeps `Left`.
const body = (sep: string) => String.raw`${SEG}(?:(?<![.,:;!?]) (?:${WORD} )*${WORD}(?:${sep}${SEG}|${CLOSE}))*`;
const BS = body(String.raw`\\`);
const FS = body("/");
/**
 * The folder right after `Users` or `home` is a username. Its capitalised words after a space belong to it
 * whatever follows, so `C:\Users\First Last and then` keeps no part of the name. Runs before the general patterns.
 */
const NAME = String.raw`[^\s"'\x60<>|()\[\]{},;\\/]+(?:(?<![.,:;!?]) [A-Z][^\s"'\x60<>|()\[\]{},;\\/]*)*`;
const USER_PATTERNS: RegExp[] = [
  // C:\Users\<name>\…, including JSON-escaped `\\`.
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:\\+[Uu]sers\\+${NAME}(?:\\+${BS})?`, "g"),
  // C:/Users/<name>/….
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:/+[Uu]sers/+${NAME}(?:/${FS})?`, "g"),
  // /home/<name>, /Users/<name>, /mnt/c/Users/<name>, /c/users/<name>, /C/home/<name>.
  new RegExp(String.raw`(?<![\w.~:/-])(?:/mnt)?(?:/[A-Za-z])?/(?:home|[Uu]sers)/${NAME}(?:/${FS})?`, "g"),
];
const PATTERNS: RegExp[] = [
  ...USER_PATTERNS,
  // Windows drive paths with backslashes, including JSON-escaped `\\`.
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:\\${BS}`, "g"),
  // Windows drive paths with forward slashes. `https://` is not a drive.
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:/${FS}`, "g"),
  // UNC shares: \\server\share\…. A 2+ character server name keeps regex text like `\\s\S` untouched.
  new RegExp(String.raw`(?<![\w.\\/:])\\\\[A-Za-z0-9._$-]{2,}\\${BS}`, "g"),
  // POSIX home directories and root's home.
  new RegExp(String.raw`(?<![\w.~:/-])/(?:home|Users|root)/${FS}`, "g"),
  // WSL drive mounts: /mnt/c/….
  new RegExp(String.raw`(?<![\w.~:/-])/mnt/[A-Za-z]/${FS}`, "g"),
  // Git Bash / MSYS home folders under a drive mount, in any case: /c/users/<name>/…, /C/home/<name>/….
  new RegExp(String.raw`(?<![\w.~:/-])/[A-Za-z]/(?:[Uu]sers|home)/${FS}`, "g"),
  // Other Git Bash / MSYS drive mounts such as /d/Projects/… or /D/Projects/…. A capitalised folder of two or more
  // characters keeps `/a/b`, `/I/O` and `/A/B` in prose untouched.
  new RegExp(String.raw`(?<![\w.~:/-])/[A-Za-z]/[A-Z][\w.-]${FS}`, "g"),
];

export const PATH_PLACEHOLDER = "<path>";

/** Replace absolute machine paths in free text with `<path>`, keeping trailing sentence punctuation. */
export function scrubMachinePaths(text: string): string {
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (match) => {
      const tail = /[.,:;!?]+$/.exec(match)?.[0] ?? "";
      return PATH_PLACEHOLDER + tail;
    });
  }
  return out;
}

/** `scrubMachinePaths` for nullable fields. */
export function scrubNullable(text: string | null | undefined): string | null {
  return text == null ? null : scrubMachinePaths(text);
}

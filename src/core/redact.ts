/**
 * Machine-path scrubbing for the committed snapshot.
 *
 * `tickets.jsonl` is committed, often to public repositories, but agents write absolute paths into
 * comments and acceptance evidence (`D:\Projects\…`, `C:/Users/<name>/…`, `/home/<name>/…`). The database
 * keeps the original text; only the exported copy is scrubbed. Repo-relative paths, `~/` paths and URLs
 * are left alone.
 *
 * Known limit: a lower-case word after a space ends the path, so `C:\Users\first last\x` keeps `last\x`.
 * Paths are free text here, and treating every space as part of a path would swallow the sentence after it.
 */

/** One path run without spaces. */
const SEG = String.raw`[^\s"'\x60<>|()\[\]{},;]*`;
/** A word that may follow a space inside a path: capitalised or numeric, no separators (`Program`, `Last`, `2`). */
const WORD = String.raw`[A-Z0-9][^\s"'\x60<>|()\[\]{},;\\/]*`;
/**
 * A path body. A space continues the path only when the following words are capitalised or numeric and the last
 * one ends in a separator, so `C:\Users\First Last\x` and `D:\Program Files\Git` are replaced whole while
 * `D:\x for and/or` and `D:/Projects/workspace map` stop at the prose.
 */
const BODY = String.raw`${SEG}(?: (?:${WORD} )*${WORD}[\\/]${SEG})*`;
const PATTERNS: RegExp[] = [
  // Windows drive paths, forward or back slashes, including JSON-escaped `\\`. `https://` is not a drive.
  new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]${BODY}`, "g"),
  // UNC shares: \\server\share\….
  new RegExp(String.raw`(?<![\w\\/:])\\\\[A-Za-z0-9._$-]+\\${BODY}`, "g"),
  // POSIX home directories and root's home.
  new RegExp(String.raw`(?<![\w.~:/-])/(?:home|Users|root)/${BODY}`, "g"),
  // WSL drive mounts: /mnt/c/….
  new RegExp(String.raw`(?<![\w.~:/-])/mnt/[A-Za-z]/${BODY}`, "g"),
  // Git Bash / MSYS drive mounts such as /d/Projects/…. The capitalised folder keeps `/a/b` in prose untouched.
  new RegExp(String.raw`(?<![\w.~:/-])/[A-Za-z]/[A-Z]${BODY}`, "g"),
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

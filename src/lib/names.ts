/**
 * Display-name validation. Runs on the SERVER for every submission — client
 * checks are only there to give fast feedback and can't be trusted.
 */

export const MAX_NAME_LENGTH = 16;
export const MIN_NAME_LENGTH = 1;
/** Hard cap on bytes accepted before we even look at the body. */
export const MAX_BODY_BYTES = 512;

/**
 * Strip characters that break a leaderboard rather than merely look odd:
 *  - C0/C1 control chars and zero-width joiners (invisible / layout-breaking)
 *  - bidi overrides, which can visually reorder other players' rows
 *  - combining marks, used to stack diacritics far outside the row ("Zalgo")
 */
const DISALLOWED = new RegExp(
  "[" +
    "\\u0000-\\u001F\\u007F-\\u009F" + // control
    "\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F" + // zero-width, bidi, invisible
    "\\uFEFF" + // BOM
    "\\u0300-\\u036F\\u0483-\\u0489\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20F0\\uFE20-\\uFE2F" + // combining
    "]",
  "gu",
);

export interface NameResult {
  ok: boolean;
  name: string;
  error?: string;
}

/**
 * Normalise and validate. Returns the cleaned name, which may differ from the
 * input — callers must store the returned value, not the original.
 */
export function cleanName(raw: unknown): NameResult {
  if (typeof raw !== "string") {
    return { ok: false, name: "", error: "Name must be text" };
  }

  // Truncate before any work so a megabyte of input can't cost us regex time.
  let name = raw.slice(0, MAX_NAME_LENGTH * 4);

  // Tabs/newlines are whitespace, not junk: turn them into spaces before the
  // control-character strip so "a\nb" reads "a b" rather than "ab".
  name = name.replace(/[\t\n\r\v\f]/g, " ");

  // NFC first: composed forms count their real length, and it collapses
  // look-alike encodings so one player can't hold several "identical" names.
  // Note this deliberately preserves ONE accent ("café" survives) while the
  // extra stacked marks of a Zalgo string are dropped by DISALLOWED below.
  name = name.normalize("NFC").replace(DISALLOWED, "");

  // Collapse internal whitespace runs, then trim.
  name = name.replace(/\s+/g, " ").trim();

  if (name.length < MIN_NAME_LENGTH) {
    return { ok: false, name: "", error: "Name can't be empty" };
  }

  // Count by code points so emoji and astral characters aren't over-counted
  // by UTF-16 surrogate pairs.
  const points = Array.from(name);
  if (points.length > MAX_NAME_LENGTH) {
    name = points.slice(0, MAX_NAME_LENGTH).join("").trim();
  }

  if (name.length < MIN_NAME_LENGTH) {
    return { ok: false, name: "", error: "Name can't be empty" };
  }

  return { ok: true, name };
}

/** Score bounds — rejects NaN, Infinity, negatives, and absurd values. */
export const MAX_SCORE = 1_000_000_000;

export function cleanScore(raw: unknown): { ok: boolean; score: number; error?: string } {
  // Only numbers and numeric strings. Without this, Number(null) === 0 and
  // Number([]) === 0 would both post a valid score of zero.
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { ok: false, score: 0, error: "Score must be a number" };
  }
  if (typeof raw === "string" && raw.trim() === "") {
    return { ok: false, score: 0, error: "Score must be a number" };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, score: 0, error: "Score must be a whole number" };
  }
  if (n < 0) return { ok: false, score: 0, error: "Score can't be negative" };
  if (n > MAX_SCORE) return { ok: false, score: 0, error: "Score out of range" };
  return { ok: true, score: n };
}

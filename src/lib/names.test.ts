import { cleanName, cleanScore } from "./names";

let pass = 0, fail = 0;
const t = (n: string, c: boolean, x = "") => { c ? pass++ : (fail++, console.log("FAIL:", n, x)); };

const ZWSP = "​";
const RLO = "‮";
const BOM = "﻿";
const COMB = "́̂̃";
const CTRL = "";

// length limits
t("16 chars ok", cleanName("abcdefghijklmnop").name.length === 16);
t("30 chars truncated to 16", Array.from(cleanName("a".repeat(30)).name).length === 16);
t("1MB input truncated", Array.from(cleanName("x".repeat(1_000_000)).name).length === 16);
t("empty rejected", !cleanName("").ok);
t("whitespace-only rejected", !cleanName("     ").ok);
t("non-string rejected", !cleanName(12345).ok && !cleanName(null).ok && !cleanName({}).ok && !cleanName(undefined).ok);
t("array rejected", !cleanName(["a"]).ok);

// trimming / collapsing
t("trims", cleanName("  bob  ").name === "bob");
t("collapses inner spaces", cleanName("a      b").name === "a b");
t("newline collapsed", cleanName("a\nb").name === "a b");
t("tab collapsed", cleanName("a\tb").name === "a b");

// injection payloads stay inert text (React escapes at render; SQL is parameterised)
t("script tag truncated", Array.from(cleanName("<script>alert(1)</script>").name).length <= 16);
t("sql-ish text accepted as text", cleanName("'; DROP TABLE--").ok);

// invisible / layout attacks
t("zero-width stripped", cleanName("a" + ZWSP + "b").name === "ab");
t("RTL override stripped", cleanName("a" + RLO + "b").name === "ab");
t("BOM stripped", cleanName(BOM + "ab").name === "ab");
// NFC composes a+first mark into a single codepoint; extras are stripped.
t("zalgo extra marks stripped", Array.from(cleanName("a" + COMB + "b").name).length === 2);
t("legit accent preserved", cleanName("caf\u00e9").name === "caf\u00e9");
t("control char stripped", cleanName("a" + CTRL + "b").name === "ab");
t("all-invisible rejected", !cleanName(ZWSP + ZWSP + ZWSP).ok);
t("RLO-only rejected", !cleanName(RLO).ok);

// unicode counting
t("emoji counted by code points <=16", Array.from(cleanName("\u{1F468}‍\u{1F469}‍\u{1F467}".repeat(10)).name).length <= 16);
t("astral chars survive", cleanName("\u{1D558}\u{1D558}").ok);
t("NFC normalises decomposed", cleanName("é").name === cleanName("é").name);

// scores
t("valid score", cleanScore(42).score === 42);
t("negative rejected", !cleanScore(-1).ok);
t("NaN rejected", !cleanScore(NaN).ok);
t("Infinity rejected", !cleanScore(Infinity).ok);
t("-Infinity rejected", !cleanScore(-Infinity).ok);
t("float rejected", !cleanScore(1.5).ok);
t("huge rejected", !cleanScore(1e12).ok);
t("string number coerced", cleanScore("7").score === 7);
t("garbage string rejected", !cleanScore("abc").ok);
t("null rejected", !cleanScore(null).ok);
t("object rejected", !cleanScore({}).ok);
t("zero allowed", cleanScore(0).ok);

console.log("---pass:", pass, "fail:", fail);
if (fail) process.exit(1);

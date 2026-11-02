import type { Header } from "../mailbox/port";

/** A header's value by case-insensitive name, RFC 2047-decoded; "" when absent. */
export function headerValue(headers: readonly Header[], name: string): string {
  const lower = name.toLowerCase();
  const h = headers.find((x) => x.name.toLowerCase() === lower);
  return h ? decodeWords(h.value) : "";
}

export function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// Labels TextDecoder doesn't know but mail clients send.
const ALIASES: Record<string, string> = { "x-sjis": "shift_jis", "ks_c_5601-1987": "euc-kr", "x-user-defined": "windows-1252", "unicode-1-1-utf-7": "utf-8", ascii: "us-ascii" };
const normalizeCharset = (c: string) => {
  const lower = c.trim().toLowerCase().replace(/^"|"$/g, "");
  return ALIASES[lower] ?? (lower || "utf-8");
};

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/**
 * Decode RFC 2047 encoded words (=?charset?B|Q?text?=). Whitespace between
 * adjacent encoded words is dropped, as the RFC requires; plain text passes
 * through unchanged, so already-decoded values are safe to run through again.
 */
export function decodeWords(value: string): string {
  if (!value.includes("=?")) return value;
  const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
  return joined.replace(ENCODED_WORD, (_m, charset: string, enc: string, text: string) => {
    // Language tags (RFC 2231): charset*lang
    const cs = charset.split("*")[0]!;
    const bytes = enc.toUpperCase() === "B" ? new Uint8Array(Buffer.from(text, "base64")) : qBytes(text);
    return decodeBytes(bytes, cs);
  });
}

function qBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

export interface Address {
  /** Display name, or "" when there's only an address. */
  name: string;
  email: string;
}

/** Split an address list on commas (and semicolons) outside quotes, angle brackets and comments. */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && quoted) {
      cur += c + (value[++i] ?? "");
      continue;
    }
    if (c === '"' && paren === 0) quoted = !quoted;
    else if (!quoted && c === "<") angle++;
    else if (!quoted && c === ">") angle = Math.max(0, angle - 1);
    else if (!quoted && c === "(") paren++;
    else if (!quoted && c === ")") paren = Math.max(0, paren - 1);
    if ((c === "," || c === ";") && !quoted && angle === 0 && paren === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const unquote = (s: string) => s.replace(/^"(.*)"$/s, "$1").replace(/\\(.)/g, "$1").trim();

/** Parse From/To/Cc into addresses. Groups ("Team: a@x, b@y;") flatten to their members. */
export function parseAddresses(raw: string): Address[] {
  const value = decodeWords(raw);
  const out: Address[] = [];
  for (let part of splitList(value)) {
    // Group syntax: drop the "Name:" prefix (outside quotes).
    const group = /^([^"<]*?):\s*/.exec(part);
    if (group && !part.slice(0, group[0].length).includes("@")) part = part.slice(group[0].length);
    if (!part) continue;
    const angle = /^(.*)<([^<>]+)>\s*(\(.*\))?$/s.exec(part);
    if (angle) {
      out.push({ name: unquote(angle[1]!.trim()), email: angle[2]!.trim() });
      continue;
    }
    const comment = /^([^\s()]+@[^\s()]+)\s*\((.*)\)$/.exec(part);
    if (comment) {
      out.push({ name: comment[2]!.trim(), email: comment[1]! });
      continue;
    }
    if (part.includes("@")) out.push({ name: "", email: part.replace(/^<|>$/g, "") });
  }
  return out;
}

/** What to call someone in a list: their display name, else the address's local part. */
export const displayName = (a: Address) => a.name || a.email.split("@")[0] || a.email;

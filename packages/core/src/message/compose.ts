import type { AttachmentData } from "../mailbox/port";
import { type Address, parseAddresses, splitList } from "./headers";
import { type ParsedMessage, htmlToText } from "./parse";

/**
 * Replies, forwards and new mail (SPEC.md, story 7): the form's starting
 * values, recipient validation, and the RFC 5322 message Gmail sends.
 * Bodies are plain text (UTF-8, base64); replies carry In-Reply-To and
 * References so they thread in Gmail and elsewhere.
 */

export const COMPOSE_MODES = ["new", "reply", "replyAll", "forward"] as const;
export type ComposeMode = (typeof COMPOSE_MODES)[number];
export const isComposeMode = (v: unknown): v is ComposeMode => typeof v === "string" && (COMPOSE_MODES as readonly string[]).includes(v);

/** The message being answered or forwarded. */
export interface Original {
  messageId: string;
  threadId: string;
  parsed: ParsedMessage;
  /** Epoch ms, for when there's no usable Date header. */
  internalDate: number;
}

export interface ComposeDefaults {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  /** Replies only: keep the reply in the original's thread. */
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** Forwards only: the original's listed attachments, sent along. */
  forwardAttachments: { messageId: string; partId: string; filename: string; size: number }[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  const name = /^[\w .'-]*$/.test(a.name) && !a.name.includes('"') ? a.name : `"${a.name.replace(/(["\\])/g, "\\$1")}"`;
  return `${name} <${a.email}>`;
}

const formatList = (list: Address[]) => list.map(formatAddress).join(", ");

function uniqueExcept(list: Address[], exclude: string[]): Address[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const out: Address[] = [];
  for (const a of list) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function prefixed(subject: string, prefix: "Re" | "Fwd"): string {
  const s = subject.trim();
  const already = prefix === "Re" ? /^(re|aw|sv|antw)\s*:/i : /^(fwd?|fw|wg)\s*:/i;
  return already.test(s) ? s : `${prefix}: ${s}`;
}

const originalText = (p: ParsedMessage) => p.text ?? (p.html ? htmlToText(p.html) : "");
const sentAt = (o: Original) => o.parsed.dateHeader || new Date(o.internalDate).toUTCString();
const quote = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`))
    .join("\n");

export function composeDefaults(mode: ComposeMode, original: Original | null, ownerEmail: string): ComposeDefaults {
  const blank: ComposeDefaults = { to: "", cc: "", bcc: "", subject: "", body: "", threadId: null, inReplyTo: null, references: [], forwardAttachments: [] };
  if (mode === "new" || !original) return blank;
  const p = original.parsed;
  const fromMe = p.from ? same(p.from.email, ownerEmail) : false;

  if (mode === "forward") {
    const header = [
      "---------- Forwarded message ---------",
      `From: ${p.from ? formatAddress(p.from) : ""}`,
      `Date: ${sentAt(original)}`,
      `Subject: ${p.subject}`,
      `To: ${formatList(p.to)}`,
      ...(p.cc.length > 0 ? [`Cc: ${formatList(p.cc)}`] : []),
    ].join("\n");
    return {
      ...blank,
      subject: prefixed(p.subject, "Fwd"),
      body: `\n\n${header}\n\n${originalText(p)}`,
      forwardAttachments: p.attachments.filter((a) => !a.inline).map((a) => ({ messageId: original.messageId, partId: a.partId, filename: a.filename, size: a.size })),
    };
  }

  // Replying to my own message goes to its recipients, as Gmail does.
  const primary = fromMe ? p.to : p.replyTo.length > 0 ? p.replyTo : p.from ? [p.from] : [];
  const to = mode === "replyAll" ? uniqueExcept([...primary, ...(fromMe ? [] : p.to)], [ownerEmail]) : uniqueExcept(primary, fromMe ? [ownerEmail] : []);
  const cc = mode === "replyAll" ? uniqueExcept(p.cc, [ownerEmail, ...to.map((a) => a.email)]) : [];
  const who = p.from ? formatAddress(p.from) : "someone";
  return {
    ...blank,
    to: formatList(to),
    cc: formatList(cc),
    subject: prefixed(p.subject, "Re"),
    body: `\n\nOn ${sentAt(original)}, ${who} wrote:\n${quote(originalText(p))}\n`,
    threadId: original.threadId,
    inReplyTo: p.messageIdHeader || null,
    references: [...p.references, ...(p.messageIdHeader ? [p.messageIdHeader] : [])].slice(-20),
  };
}

const EMAIL = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[^\s@<>(),;:"\\[\].]+$/;

export type Recipients = { ok: true; addresses: Address[] } | { ok: false; invalid: string[] };

/** Parse a To/Cc/Bcc field; anything that isn't one plain valid address is reported back as typed. */
export function parseRecipients(field: string): Recipients {
  const addresses: Address[] = [];
  const invalid: string[] = [];
  for (const entry of splitList(field.replace(/\n/g, ","))) {
    const parsed = parseAddresses(entry);
    if (parsed.length === 1 && EMAIL.test(parsed[0]!.email)) addresses.push(parsed[0]!);
    else invalid.push(entry);
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, addresses: uniqueExcept(addresses, []) };
}

export interface OutgoingMessage {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string[];
  attachments: AttachmentData[];
  date: Date;
}

/** No header value may carry a line break: that's how header injection works. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ");
const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 B-encoding, split so no encoded word exceeds 75 characters or a UTF-8 sequence. */
export function encodeWord(s: string): string {
  if (isAscii(s)) return s;
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

function headerAddress(a: Address): string {
  const email = oneLine(a.email);
  if (!a.name) return email;
  const name = oneLine(a.name);
  return `${isAscii(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : encodeWord(name)} <${email}>`;
}

const base64Lines = (bytes: Uint8Array) => (Buffer.from(bytes).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");

/** RFC 2231 filename parameter, for names that aren't plain ASCII. */
function filenameParams(name: string): string {
  const clean = oneLine(name).replace(/["\\]/g, "_") || "attachment";
  if (isAscii(clean)) return `filename="${clean}"`;
  return `filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const boundary = () => `mail-${crypto.getRandomValues(new Uint32Array(4)).join("-")}`;

/** The message as sent: CRLF line endings, UTF-8 throughout. */
export function buildMime(m: OutgoingMessage): string {
  const headers = [
    `From: ${headerAddress(m.from)}`,
    ...(m.to.length > 0 ? [`To: ${m.to.map(headerAddress).join(", ")}`] : []),
    ...(m.cc.length > 0 ? [`Cc: ${m.cc.map(headerAddress).join(", ")}`] : []),
    // Gmail delivers to Bcc and strips the header from what recipients see.
    ...(m.bcc.length > 0 ? [`Bcc: ${m.bcc.map(headerAddress).join(", ")}`] : []),
    `Subject: ${encodeWord(oneLine(m.subject))}`,
    `Date: ${m.date.toUTCString().replace("GMT", "+0000")}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${oneLine(m.inReplyTo)}`] : []),
    ...(m.references.length > 0 ? [`References: ${m.references.map(oneLine).join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lines(new TextEncoder().encode(m.body.replace(/\r?\n/g, "\r\n")))].join("\r\n");
  if (m.attachments.length === 0) return `${headers.join("\r\n")}\r\n${text}\r\n`;

  const b = boundary();
  const parts = [
    text,
    ...m.attachments.map((a) =>
      [
        `Content-Type: ${oneLine(a.mimeType) || "application/octet-stream"}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; ${filenameParams(a.filename)}`,
        "",
        base64Lines(a.bytes),
      ].join("\r\n"),
    ),
  ];
  return `${headers.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n${parts.map((p) => `--${b}\r\n${p}\r\n`).join("")}--${b}--\r\n`;
}

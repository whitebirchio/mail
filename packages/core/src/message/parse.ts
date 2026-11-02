import type { FullMessage, Header, Part } from "../mailbox/port";
import { type Address, decodeBytes, decodeWords, headerValue, parseAddresses } from "./headers";

/**
 * A Gmail payload tree → what Mail shows (SPEC.md, story 5). Gmail has
 * already undone each part's Content-Transfer-Encoding; part bodies arrive
 * as base64url bytes in the part's own charset, which is decoded here.
 */

export interface AttachmentInfo {
  partId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Content-ID without angle brackets, if the part has one. */
  contentId: string | null;
  /** Referenced from the HTML body as cid:, so it's shown in place rather than listed. */
  inline: boolean;
}

export interface ParsedMessage {
  from: Address | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  /** The Date header, as sent; internalDate is what lists sort by. */
  dateHeader: string;
  messageIdHeader: string;
  references: string[];
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
}

const lower = (s: string) => s.toLowerCase();
const param = (contentType: string, name: string): string | null => {
  const m = new RegExp(`;\\s*${name}\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(contentType);
  return m ? (m[2] ?? m[1]!) : null;
};

export function partText(part: Part): string {
  if (!part.body.data) return "";
  const bytes = new Uint8Array(Buffer.from(part.body.data, "base64url"));
  return decodeBytes(bytes, param(headerValue(part.headers, "Content-Type"), "charset") ?? "utf-8");
}

const disposition = (p: Part) => lower(headerValue(p.headers, "Content-Disposition").split(";")[0]!.trim());
const contentId = (p: Part) => headerValue(p.headers, "Content-ID").trim().replace(/^<|>$/g, "") || null;
const isBodyText = (p: Part) => (lower(p.mimeType) === "text/plain" || lower(p.mimeType) === "text/html") && !p.filename && disposition(p) !== "attachment";

interface Bodies {
  html: string[];
  text: string[];
}

function bodies(part: Part): Bodies {
  const type = lower(part.mimeType);
  const children = part.parts ?? [];
  if (!type.startsWith("multipart/")) {
    if (!isBodyText(part)) return { html: [], text: [] };
    return type === "text/html" ? { html: [partText(part)], text: [] } : { html: [], text: [partText(part)] };
  }
  if (type === "multipart/alternative") {
    // Alternatives are the same content: the last one with HTML wins (RFC 2046 orders them plainest first), with the plainest text alongside.
    const options = children.map(bodies);
    const rich = options.filter((o) => o.html.length > 0).at(-1);
    const plain = options.find((o) => o.text.length > 0 && o.html.length === 0) ?? options.find((o) => o.text.length > 0);
    return { html: rich?.html ?? [], text: plain?.text ?? [] };
  }
  if (type === "multipart/related") {
    // The root is the `start` part, or the first; the rest are resources it references.
    const start = param(headerValue(part.headers, "Content-Type"), "start")?.replace(/^<|>$/g, "");
    const root = (start && children.find((c) => contentId(c) === start)) || children[0];
    return root ? bodies(root) : { html: [], text: [] };
  }
  // multipart/mixed, /digest, /signed, …: each body-like child in order.
  const all = children.map(bodies);
  return { html: all.flatMap((b) => b.html), text: all.flatMap((b) => b.text) };
}

function leaves(part: Part): Part[] {
  return lower(part.mimeType).startsWith("multipart/") ? (part.parts ?? []).flatMap(leaves) : [part];
}

export function findPart(part: Part, partId: string): Part | null {
  if (part.partId === partId) return part;
  for (const c of part.parts ?? []) {
    const hit = findPart(c, partId);
    if (hit) return hit;
  }
  return null;
}

const messageIds = (v: string) => v.match(/<[^<>\s]+>/g) ?? [];

export function parseMessage(m: Pick<FullMessage, "payload" | "headers">): ParsedMessage {
  const top: Header[] = m.payload.headers.length > 0 ? m.payload.headers : m.headers;
  const b = bodies(m.payload);
  const html = b.html.length > 0 ? b.html.join("\n<hr>\n") : null;
  const text = b.text.length > 0 ? b.text.join("\n\n") : null;

  const attachments: AttachmentInfo[] = leaves(m.payload)
    .filter((p) => !isBodyText(p) && (p.body.size > 0 || p.body.attachmentId))
    .map((p) => {
      const cid = contentId(p);
      return {
        partId: p.partId,
        filename: decodeWords(p.filename) || defaultName(p.mimeType),
        mimeType: lower(p.mimeType) || "application/octet-stream",
        size: p.body.size,
        contentId: cid,
        inline: Boolean(cid && html && (html.includes(`cid:${cid}`) || html.includes(`cid:${encodeURIComponent(cid)}`))),
      };
    });

  return {
    from: parseAddresses(headerValue(top, "From"))[0] ?? null,
    to: parseAddresses(headerValue(top, "To")),
    cc: parseAddresses(headerValue(top, "Cc")),
    bcc: parseAddresses(headerValue(top, "Bcc")),
    replyTo: parseAddresses(headerValue(top, "Reply-To")),
    subject: headerValue(top, "Subject"),
    dateHeader: headerValue(top, "Date"),
    messageIdHeader: messageIds(headerValue(top, "Message-ID"))[0] ?? "",
    references: messageIds(headerValue(top, "References")),
    html,
    text,
    attachments,
  };
}

function defaultName(mimeType: string): string {
  const t = lower(mimeType);
  if (t === "message/rfc822") return "message.eml";
  if (t === "text/calendar") return "invite.ics";
  const ext = t.split("/")[1]?.replace(/[^a-z0-9]/g, "");
  return ext ? `attachment.${ext}` : "attachment";
}

/** Plain text of an HTML body, for quoting in replies when there's no text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (named[e.toLowerCase()]) return named[e.toLowerCase()]!;
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

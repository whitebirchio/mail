/** Synthetic MIME trees in Gmail's payload shape (bodies transfer-decoded, then base64url). Invented content only. */
import type { FullMessage, Header, Part } from "../../src/mailbox/port";

let n = 0;
const b64 = (bytes: Uint8Array | string) => Buffer.from(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes).toString("base64url");

export interface LeafOpts {
  charset?: string;
  bytes?: Uint8Array;
  filename?: string;
  cid?: string;
  disposition?: "inline" | "attachment";
  attachmentId?: string;
  headers?: Header[];
}

export function leaf(mimeType: string, content: string, o: LeafOpts = {}): Part {
  const headers: Header[] = [{ name: "Content-Type", value: `${mimeType}${o.charset ? `; charset="${o.charset}"` : ""}${o.filename ? `; name="${o.filename}"` : ""}` }];
  if (o.cid) headers.push({ name: "Content-ID", value: `<${o.cid}>` });
  if (o.disposition) headers.push({ name: "Content-Disposition", value: `${o.disposition}${o.filename ? `; filename="${o.filename}"` : ""}` });
  const raw = o.bytes ?? Buffer.from(content, "utf8");
  return {
    partId: String(n++),
    mimeType,
    filename: o.filename ?? "",
    headers: [...headers, ...(o.headers ?? [])],
    body: o.attachmentId ? { size: raw.length, attachmentId: o.attachmentId } : { size: raw.length, data: b64(raw) },
  };
}

export function multi(subtype: string, parts: Part[], extra = ""): Part {
  return { partId: String(n++), mimeType: `multipart/${subtype}`, filename: "", headers: [{ name: "Content-Type", value: `multipart/${subtype}; boundary="b"${extra}` }], body: { size: 0 }, parts };
}

/** Number partIds the way Gmail does: "" for the root, then "0", "0.1", … */
export function numbered(root: Part): Part {
  const walk = (p: Part, id: string): Part => ({ ...p, partId: id, parts: p.parts?.map((c, i) => walk(c, id === "" ? String(i) : `${id}.${i}`)) });
  return walk(root, "");
}

export function message(id: string, payload: Part, headers: Header[] = [], over: Partial<FullMessage> = {}): FullMessage {
  const defaults: Header[] = [
    { name: "From", value: "Ann Example <ann@example.org>" },
    { name: "To", value: "owner@example.com" },
    { name: "Subject", value: "Plans" },
    { name: "Message-ID", value: `<${id}@mail.example.org>` },
  ];
  // Given headers replace defaults of the same name.
  const all = [...defaults.filter((d) => !headers.some((h) => h.name.toLowerCase() === d.name.toLowerCase())), ...headers];
  const root = numbered({ ...payload, headers: [...all, ...payload.headers] });
  return { id, threadId: "t1", labelIds: ["INBOX"], internalDate: 1_790_000_000_000, snippet: "", headers: root.headers, mimeType: root.mimeType, payload: root, ...over };
}

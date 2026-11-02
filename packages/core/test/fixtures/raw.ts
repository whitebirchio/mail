/** Test-only: read a raw RFC 5322 message (as buildMime writes it) into Gmail's payload shape, decoding base64 bodies. */
import type { Header, Part } from "../../src/mailbox/port";

function split(raw: string): { headers: Header[]; body: string } {
  const at = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, at).replace(/\r\n[ \t]/g, " ");
  const headers = head.split("\r\n").map((l) => {
    const i = l.indexOf(":");
    return { name: l.slice(0, i), value: l.slice(i + 1).trim() };
  });
  return { headers, body: raw.slice(at + 4) };
}

let id = 0;
export function readRaw(raw: string): Part {
  const { headers, body } = split(raw);
  const ct = headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "text/plain";
  const mimeType = ct.split(";")[0]!.trim().toLowerCase();
  if (mimeType.startsWith("multipart/")) {
    const boundary = /boundary="([^"]+)"/.exec(ct)![1]!;
    const chunks = body.split(`--${boundary}`).slice(1, -1).map((c) => c.replace(/^\r\n/, "").replace(/\r\n$/, ""));
    return { partId: String(id++), mimeType, filename: "", headers, body: { size: 0 }, parts: chunks.map(readRaw) };
  }
  const bytes = Buffer.from(body.replace(/\r\n/g, ""), "base64");
  const cd = headers.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
  const plain = /filename="([^"]+)"/.exec(cd)?.[1];
  const star = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
  const filename = plain ?? (star ? decodeURIComponent(star) : "");
  return { partId: String(id++), mimeType, filename, headers, body: { size: bytes.length, data: bytes.toString("base64url") } };
}

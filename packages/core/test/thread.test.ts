import { describe, expect, it } from "vitest";
import type { TokenSource } from "../src/google/token";
import { GmailMailbox } from "../src/mailbox/gmail";
import { FakeMailbox } from "../src/mailbox/fake";
import { threadView } from "../src/views/thread";
import { leaf, message, multi } from "./fixtures/mime";

const opts = (shown: string[] = []) => ({
  ownerEmail: "owner@example.com",
  showImages: (id: string) => shown.includes(id),
  attachmentUrl: (m: string, p: string) => `/attachments/${m}/${p}`,
});

const html = (body: string) => multi("alternative", [leaf("text/plain", "text"), leaf("text/html", body)]);

describe("threadView", () => {
  const thread = {
    id: "t1",
    messages: [
      message("m2", html('<p>Second <img src="https://cdn.example/x.png"></p>'), [], { internalDate: 2000, labelIds: ["INBOX"] }),
      message("m1", leaf("text/plain", "First https://example.org"), [{ name: "From", value: "Owner <owner@example.com>" }], { internalDate: 1000, labelIds: ["SENT"] }),
      message("m3", html("<p>Third</p>"), [], { internalDate: 3000, labelIds: ["INBOX", "UNREAD"] }),
      message("m4", leaf("text/plain", "draft"), [{ name: "From", value: "owner@example.com" }], { internalDate: 4000, labelIds: ["DRAFT"] }),
    ],
  };

  it("orders messages, expands the latest sent one and any unread, and names me", () => {
    const v = threadView(thread, opts());
    expect(v.messages.map((m) => [m.id, m.expanded, m.fromName])).toEqual([
      ["m1", false, "me"],
      ["m2", false, "Ann Example"],
      ["m3", true, "Ann Example"],
      ["m4", false, "me"],
    ]);
    expect(v).toMatchObject({ id: "t1", subject: "Plans", unread: true });
    expect(v.messages[3]!.draft).toBe(true);
  });

  it("renders text as linked text and HTML sanitized, with remote images held back per message", () => {
    const v = threadView(thread, opts());
    expect(v.messages[0]!.document).toContain('<a href="https://example.org"');
    expect(v.messages[1]!.document).not.toContain("cdn.example");
    expect(v.messages[1]!.blockedImages).toBe(1);
    const shown = threadView(thread, opts(["m2"]));
    expect(shown.messages[1]!.document).toContain('src="https://cdn.example/x.png"');
    expect(shown.messages[1]!.imagesShown).toBe(true);
  });

  it("serves inline images from the attachment route and lists only the others", () => {
    const tree = multi("mixed", [
      multi("related", [leaf("text/html", '<img src="cid:pic">'), leaf("image/png", "P", { cid: "pic", filename: "pic.png" })]),
      leaf("application/pdf", "%PDF", { filename: "a.pdf", disposition: "attachment" }),
    ]);
    const v = threadView({ id: "t", messages: [message("mx", tree)] }, opts());
    expect(v.messages[0]!.document).toContain('src="/attachments/mx/0.1"');
    expect(v.messages[0]!.attachments).toEqual([expect.objectContaining({ filename: "a.pdf", url: "/attachments/mx/1" })]);
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tokens: TokenSource = { get: async () => ({ ok: true, accessToken: "ya29.t" }) };
const wire = (m: ReturnType<typeof message>) => ({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.snippet, internalDate: String(m.internalDate), payload: m.payload });

describe("GmailMailbox.getThread and getAttachment", () => {
  const msg = message("m1", multi("mixed", [leaf("text/plain", "x"), leaf("application/pdf", "", { filename: "a.pdf", attachmentId: "ATT", bytes: new Uint8Array([1, 2, 3]) }), leaf("image/png", "small", { filename: "s.png" })]));

  it("fetches a whole thread in full format", async () => {
    const urls: string[] = [];
    const fetchFn = (async (u: string) => {
      urls.push(u);
      return json({ id: "t1", messages: [wire(msg)] });
    }) as unknown as typeof fetch;
    const r = await new GmailMailbox(tokens, { fetchFn }).getThread("t1");
    expect(urls[0]).toMatch(/\/threads\/t1\?format=full$/);
    expect(r.ok && r.value.messages[0]!.payload.parts).toHaveLength(3);
  });

  it("returns stored attachments via attachments.get and small inline parts from the message", async () => {
    const fetchFn = (async (u: string) =>
      u.includes("/attachments/ATT") ? json({ size: 3, data: Buffer.from([1, 2, 3]).toString("base64url") }) : json(wire(msg))) as unknown as typeof fetch;
    const mb = new GmailMailbox(tokens, { fetchFn });
    expect(await mb.getAttachment("m1", "1")).toEqual({ ok: true, value: { filename: "a.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) } });
    const small = await mb.getAttachment("m1", "2");
    expect(small.ok && Buffer.from(small.value.bytes).toString()).toBe("small");
    expect(await mb.getAttachment("m1", "")).toEqual({ ok: false, error: "not-found" }); // the multipart root isn't a file
    expect(await mb.getAttachment("m1", "7")).toEqual({ ok: false, error: "not-found" });
  });

  it("the fake serves full threads and parts too", async () => {
    const fake = new FakeMailbox([{ id: "t1", messages: [msg] }]);
    expect((await fake.getThread("t1")).ok).toBe(true);
    expect(await fake.getThread("nope")).toEqual({ ok: false, error: "not-found" });
    const p = await fake.getAttachment("m1", "2");
    expect(p.ok && p.value.filename).toBe("s.png");
  });
});

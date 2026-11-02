import { describe, expect, it } from "vitest";
import { FakeMailbox } from "../src/mailbox/fake";
import { buildMime, composeDefaults, encodeWord, formatAddress, parseRecipients, prefixed, type Original } from "../src/message/compose";
import { parseMessage } from "../src/message/parse";
import { sendMail } from "../src/send";
import { leaf, message, multi } from "./fixtures/mime";
import { readRaw } from "./fixtures/raw";

const OWNER = "owner@example.com";

function original(headers: { name: string; value: string }[], payload = leaf("text/plain", "Line one\n> earlier\nLine three")): Original {
  const m = message("m1", payload, headers, { threadId: "t1" });
  return { messageId: "m1", threadId: "t1", parsed: parseMessage(m), internalDate: m.internalDate };
}

const received = original([
  { name: "From", value: "Ann Example <ann@example.org>" },
  { name: "To", value: `Owner <${OWNER}>, Bob <bob@example.org>` },
  { name: "Cc", value: "cy@example.org, OWNER@example.com, bob@example.org" },
  { name: "Subject", value: "Plans" },
  { name: "Date", value: "Mon, 2 Nov 2026 13:05:00 -0600" },
  { name: "Message-ID", value: "<m1@mail.example.org>" },
  { name: "References", value: "<m0@mail.example.org>" },
]);

describe("composeDefaults", () => {
  it("replies to the sender, quoting the original, threaded", () => {
    const d = composeDefaults("reply", received, OWNER);
    expect(d).toMatchObject({
      to: "Ann Example <ann@example.org>",
      cc: "",
      subject: "Re: Plans",
      threadId: "t1",
      inReplyTo: "<m1@mail.example.org>",
      references: ["<m0@mail.example.org>", "<m1@mail.example.org>"],
    });
    expect(d.body).toBe("\n\nOn Mon, 2 Nov 2026 13:05:00 -0600, Ann Example <ann@example.org> wrote:\n> Line one\n>> earlier\n> Line three\n");
  });

  it("reply-all adds the other recipients, minus me, de-duplicated, keeping Cc", () => {
    const d = composeDefaults("replyAll", received, OWNER);
    expect(d.to).toBe("Ann Example <ann@example.org>, Bob <bob@example.org>");
    expect(d.cc).toBe("cy@example.org");
  });

  it("honours Reply-To, and replying to my own message goes to its recipients", () => {
    const list = original([
      { name: "From", value: "News <news@example.org>" },
      { name: "Reply-To", value: "replies@example.org" },
    ]);
    expect(composeDefaults("reply", list, OWNER).to).toBe("replies@example.org");
    const mine = original([
      { name: "From", value: `Owner <${OWNER}>` },
      { name: "To", value: "Dee <dee@example.org>" },
    ]);
    expect(composeDefaults("reply", mine, OWNER).to).toBe("Dee <dee@example.org>");
    expect(composeDefaults("replyAll", mine, OWNER).to).toBe("Dee <dee@example.org>");
  });

  it("forwards with a header block, the original's text and its listed attachments", () => {
    const withFile = original(
      [{ name: "From", value: "Ann <ann@example.org>" }, { name: "Subject", value: "Fwd: Report" }, { name: "Date", value: "Tue, 3 Nov 2026 09:00:00 +0000" }],
      multi("mixed", [leaf("text/html", "<p>See <b>attached</b></p>"), leaf("application/pdf", "%PDF", { filename: "r.pdf", disposition: "attachment" })]),
    );
    const d = composeDefaults("forward", withFile, OWNER);
    expect(d.to).toBe("");
    expect(d.subject).toBe("Fwd: Report");
    expect(d.threadId).toBeNull();
    expect(d.body).toContain("---------- Forwarded message ---------\nFrom: Ann <ann@example.org>\nDate: Tue, 3 Nov 2026 09:00:00 +0000\nSubject: Fwd: Report");
    expect(d.body).toContain("See attached");
    expect(d.forwardAttachments).toEqual([{ messageId: "m1", partId: "1", filename: "r.pdf", size: 4 }]);
  });

  it("starts a new message blank", () => {
    expect(composeDefaults("new", null, OWNER)).toMatchObject({ to: "", subject: "", body: "", threadId: null });
  });
});

describe("helpers", () => {
  it("prefixes subjects once, in several languages", () => {
    expect(prefixed("Plans", "Re")).toBe("Re: Plans");
    expect(prefixed("RE: Plans", "Re")).toBe("RE: Plans");
    expect(prefixed("AW: Pläne", "Re")).toBe("AW: Pläne");
    expect(prefixed("Fw: x", "Fwd")).toBe("Fw: x");
    expect(prefixed("Re: x", "Fwd")).toBe("Fwd: Re: x");
  });

  it("formats addresses, quoting names that need it", () => {
    expect(formatAddress({ name: "Ann Example", email: "a@x.org" })).toBe("Ann Example <a@x.org>");
    expect(formatAddress({ name: "Example, Ann", email: "a@x.org" })).toBe('"Example, Ann" <a@x.org>');
    expect(formatAddress({ name: "", email: "a@x.org" })).toBe("a@x.org");
  });

  it("validates recipient fields, reporting what was typed", () => {
    expect(parseRecipients('"Example, Ann" <ann@example.org>, bob@example.org')).toEqual({
      ok: true,
      addresses: [
        { name: "Example, Ann", email: "ann@example.org" },
        { name: "", email: "bob@example.org" },
      ],
    });
    expect(parseRecipients("bob@example.org, not an address, cy@nowhere")).toEqual({ ok: false, invalid: ["not an address", "cy@nowhere"] });
    expect(parseRecipients("  ")).toEqual({ ok: true, addresses: [] });
  });

  it("encodes non-ASCII header words in short UTF-8 chunks", () => {
    expect(encodeWord("Plain")).toBe("Plain");
    const long = encodeWord("日本語のとても長い件名です、ちゃんと分割されますか？");
    for (const w of long.split("\r\n ")) expect(w.length).toBeLessThanOrEqual(75);
  });
});

describe("buildMime", () => {
  const base = {
    from: { name: "Owner", email: OWNER },
    to: [{ name: "Renée", email: "renee@example.org" }],
    cc: [],
    bcc: [{ name: "", email: "hidden@example.org" }],
    subject: "Café 🎉 plans",
    body: "Bonjour, ça va?\n日本\nhttps://example.org",
    inReplyTo: "<m1@mail.example.org>",
    references: ["<m0@mail.example.org>", "<m1@mail.example.org>"],
    attachments: [],
    date: new Date("2026-11-02T19:05:00Z"),
  };

  it("writes CRLF headers with threading, Bcc for Gmail, and a UTF-8 body that round-trips", () => {
    const raw = buildMime(base);
    expect(raw).toContain("\r\nIn-Reply-To: <m1@mail.example.org>\r\n");
    expect(raw).toContain("\r\nReferences: <m0@mail.example.org> <m1@mail.example.org>\r\n");
    expect(raw).toContain("\r\nBcc: hidden@example.org\r\n");
    expect(raw).toContain("\r\nDate: Mon, 02 Nov 2026 19:05:00 +0000\r\n");
    expect(raw.split("\r\n").every((l) => l.length <= 998)).toBe(true);
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const p = parseMessage({ payload: readRaw(raw), headers: [] });
    expect(p.subject).toBe("Café 🎉 plans");
    expect(p.to).toEqual([{ name: "Renée", email: "renee@example.org" }]);
    expect(p.text).toBe("Bonjour, ça va?\r\n日本\r\nhttps://example.org");
  });

  it("can't be header-injected through the subject or a name", () => {
    const raw = buildMime({ ...base, subject: "Hi\r\nBcc: evil@example.org", to: [{ name: "x\r\nBcc: evil@example.org", email: "renee@example.org" }], bcc: [] });
    expect(raw).not.toMatch(/\r\nBcc:/);
  });

  it("attaches files as multipart/mixed, with RFC 2231 names for non-ASCII", () => {
    const raw = buildMime({
      ...base,
      attachments: [
        { filename: "report.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
        { filename: "résumé.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("hi") },
      ],
    });
    const p = parseMessage({ payload: readRaw(raw), headers: [] });
    expect(p.text).toContain("Bonjour");
    expect(p.attachments.map((a) => [a.filename, a.mimeType, a.size])).toEqual([
      ["report.pdf", "application/pdf", 4],
      ["résumé.txt", "text/plain", 2],
    ]);
  });
});

describe("sendMail", () => {
  const input = { to: "Ann <ann@example.org>", cc: "", bcc: "", subject: "Re: Plans", body: "Sounds good", threadId: "t1", inReplyTo: "<m1@x>", references: ["<m1@x>"], forward: [] };
  const from = { email: OWNER, name: "Owner" };

  it("sends a threaded reply", async () => {
    const fake = new FakeMailbox();
    expect(await sendMail(fake, input, from, new Date())).toEqual({ ok: true, id: "sent-1", threadId: "t1" });
    expect(fake.sent[0]!.threadId).toBe("t1");
    expect(fake.sent[0]!.raw).toContain("In-Reply-To: <m1@x>");
  });

  it("refuses bad or missing recipients, naming the field", async () => {
    const fake = new FakeMailbox();
    expect(await sendMail(fake, { ...input, cc: "oops" }, from, new Date())).toEqual({ ok: false, error: "invalid-recipients", field: "cc", invalid: ["oops"] });
    expect(await sendMail(fake, { ...input, to: "" }, from, new Date())).toEqual({ ok: false, error: "no-recipients" });
    expect(fake.sent).toHaveLength(0);
  });

  it("drops malformed threading headers rather than sending them", async () => {
    const fake = new FakeMailbox();
    await sendMail(fake, { ...input, inReplyTo: "not-an-id\r\nX: y", references: ["<ok@x>", "bad"] }, from, new Date());
    expect(fake.sent[0]!.raw).not.toContain("In-Reply-To");
    expect(fake.sent[0]!.raw).toContain("References: <ok@x>\r\n");
  });

  it("fetches forwarded attachments, and enforces the size limit", async () => {
    const msg = message("m9", multi("mixed", [leaf("text/plain", "x"), leaf("application/pdf", "%PDF-1", { filename: "a.pdf" })]));
    const fake = new FakeMailbox([{ id: "t9", messages: [msg] }]);
    const r = await sendMail(fake, { ...input, threadId: null, forward: [{ messageId: "m9", partId: "1" }] }, from, new Date());
    expect(r.ok).toBe(true);
    expect(parseMessage({ payload: readRaw(fake.sent[0]!.raw), headers: [] }).attachments[0]!.filename).toBe("a.pdf");
    const big = message("m8", multi("mixed", [leaf("text/plain", "x"), leaf("application/zip", "", { filename: "big.zip", bytes: new Uint8Array(26 * 1024 * 1024) })]));
    const fakeBig = new FakeMailbox([{ id: "t8", messages: [big] }]);
    expect(await sendMail(fakeBig, { ...input, forward: [{ messageId: "m8", partId: "1" }] }, from, new Date())).toEqual({ ok: false, error: "too-large" });
  });
});

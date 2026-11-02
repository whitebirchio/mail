import { FakeMailbox, type FullMessage, type Header, type Part } from "@mail/core";

/**
 * `MAIL_DEV_FAKE=1 npm run dev` only (see config.ts): an in-memory mailbox
 * of invented mail, for working on the UI without a Google client. Every
 * person, address and message here is made up.
 */

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
let partSeq = 0;
const leaf = (mimeType: string, content: string, extra: Header[] = [], filename = ""): Part => ({
  partId: String(partSeq++),
  mimeType,
  filename,
  headers: [{ name: "Content-Type", value: `${mimeType}; charset=utf-8` }, ...extra],
  body: { size: Buffer.byteLength(content), data: b64(content) },
});
const multi = (sub: string, parts: Part[]): Part => ({ partId: String(partSeq++), mimeType: `multipart/${sub}`, filename: "", headers: [{ name: "Content-Type", value: `multipart/${sub}` }], body: { size: 0 }, parts });
const number = (p: Part, id = ""): Part => ({ ...p, partId: id, parts: p.parts?.map((c, i) => number(c, id === "" ? String(i) : `${id}.${i}`)) });

const OWNER = "Scott <scott.schmalz@gmail.com>";
const HOUR = 3_600_000;
const now = Date.now();
let msgSeq = 0;

function msg(threadId: string, o: { from: string; to?: string; cc?: string; subject: string; ago: number; labels: string[]; snippet: string; body: Part }): FullMessage {
  const id = `dev${++msgSeq}`;
  const headers: Header[] = [
    { name: "From", value: o.from },
    { name: "To", value: o.to ?? OWNER },
    ...(o.cc ? [{ name: "Cc", value: o.cc }] : []),
    { name: "Subject", value: o.subject },
    { name: "Date", value: new Date(now - o.ago).toUTCString() },
    { name: "Message-ID", value: `<${id}@dev.example>` },
  ];
  const payload = number({ ...o.body, headers: [...headers, ...o.body.headers] });
  return { id, threadId, labelIds: o.labels, internalDate: now - o.ago, snippet: o.snippet, headers: payload.headers, mimeType: payload.mimeType, payload };
}

const alt = (text: string, html: string) => multi("alternative", [leaf("text/plain", text), leaf("text/html", html)]);

function seed(): FakeMailbox {
  const threads = [
    {
      id: "th-lunch",
      messages: [
        msg("th-lunch", { from: "Ann Example <ann@example.org>", subject: "Lunch on Friday?", ago: 26 * HOUR, labels: ["INBOX"], snippet: "Are we still on for noon at the usual place?", body: leaf("text/plain", "Hi!\n\nAre we still on for noon at the usual place?\n\nAnn") }),
        msg("th-lunch", { from: OWNER, to: "Ann Example <ann@example.org>", subject: "Re: Lunch on Friday?", ago: 25 * HOUR, labels: ["SENT"], snippet: "Yes, see you there.", body: leaf("text/plain", "Yes, see you there.\n\nOn Sat, Ann Example wrote:\n> Are we still on for noon?") }),
        msg("th-lunch", { from: "Ann Example <ann@example.org>", cc: "Bob Sample <bob@example.org>", subject: "Re: Lunch on Friday?", ago: 2 * HOUR, labels: ["INBOX", "UNREAD"], snippet: "Bob is coming too. I booked a table for three.", body: leaf("text/plain", "Bob is coming too. I booked a table for three: https://example.org/booking/123\n\nAnn") }),
      ],
    },
    {
      id: "th-receipt",
      messages: [
        msg("th-receipt", {
          from: "Example Store <orders@store.example>",
          subject: "Your order #10442 has shipped",
          ago: 5 * HOUR,
          labels: ["INBOX", "UNREAD"],
          snippet: "Your package is on its way. Track it any time.",
          body: multi("mixed", [
            multi("related", [
              alt(
                "Your package is on its way.",
                `<table width="100%" cellpadding="0" style="font-family:Arial;background:#f4f4f4"><tr><td align="center" style="padding:24px"><table width="560" style="background:#fff;border-radius:8px"><tr><td style="padding:24px"><img src="cid:logo@store" width="120" alt="Example Store"><h2 style="color:#222">Your package is on its way</h2><p>Order <b>#10442</b> shipped today.</p><img src="https://tracker.example/open.gif" width="1" height="1"><p><a href="https://store.example/track/10442" style="background:#2a78d6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Track package</a></p><script>alert("this never runs")</script></td></tr></table></td></tr></table>`,
              ),
              leaf("image/png", "PNG", [{ name: "Content-ID", value: "<logo@store>" }], "logo.png"),
            ]),
            leaf("application/pdf", "%PDF-1.4 invented receipt", [{ name: "Content-Disposition", value: 'attachment; filename="receipt-10442.pdf"' }], "receipt-10442.pdf"),
          ]),
        }),
      ],
    },
    {
      id: "th-news",
      messages: [
        msg("th-news", { from: "Weekly Digest <digest@news.example>", subject: "This week: five things worth reading", ago: 30 * HOUR, labels: ["INBOX"], snippet: "A short, invented newsletter for testing the layout.", body: alt("A short newsletter.", `<div style="max-width:600px;margin:auto;font-family:Georgia"><h1>Five things</h1><p style="background:url(https://cdn.news.example/hero.jpg)">An invented newsletter.</p><ol><li>One</li><li>Two</li></ol></div>`) }),
      ],
    },
    {
      id: "th-star",
      messages: [
        msg("th-star", { from: "Dee Placeholder <dee@example.net>", subject: "Photos from the trip 📷", ago: 72 * HOUR, labels: ["INBOX", "STARRED"], snippet: "Here are the ones I promised.", body: multi("mixed", [leaf("text/plain", "Here are the ones I promised."), leaf("image/jpeg", "JPEG", [{ name: "Content-Disposition", value: 'attachment; filename="beach.jpg"' }], "beach.jpg")]) }),
      ],
    },
    {
      id: "th-archived",
      messages: [msg("th-archived", { from: "Utility Co <billing@utility.example>", subject: "Your October statement", ago: 400 * HOUR, labels: [], snippet: "Your statement is ready.", body: leaf("text/plain", "Your statement is ready.") })],
    },
    {
      id: "th-spam",
      messages: [msg("th-spam", { from: "Prize Desk <win@prizes.example>", subject: "You may have won!!!", ago: 10 * HOUR, labels: ["SPAM", "UNREAD"], snippet: "Claim now.", body: leaf("text/plain", "Claim now.") })],
    },
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `th-bulk-${i}`,
      messages: [msg(`th-bulk-${i}`, { from: `Sender ${i + 1} <sender${i + 1}@example.com>`, subject: `Invented message number ${i + 1}`, ago: (100 + i * 20) * HOUR, labels: ["INBOX"], snippet: "Filler so the inbox has more than one page.", body: leaf("text/plain", "Filler.") })],
    })),
  ];
  return new FakeMailbox(threads, [
    { id: "Label_1", name: "Receipts" },
    { id: "Label_2", name: "Travel" },
  ]);
}

const g = globalThis as { __mailDevMailbox?: FakeMailbox };
export const devMailbox = () => (g.__mailDevMailbox ??= seed());

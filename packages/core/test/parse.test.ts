import { describe, expect, it } from "vitest";
import { findPart, htmlToText, parseMessage } from "../src/message/parse";
import { leaf, message, multi } from "./fixtures/mime";

describe("parseMessage: picking the body", () => {
  it("prefers HTML in multipart/alternative and keeps the text alternative", () => {
    const p = parseMessage(message("m", multi("alternative", [leaf("text/plain", "Hi there"), leaf("text/html", "<p>Hi <b>there</b></p>")])));
    expect(p.html).toBe("<p>Hi <b>there</b></p>");
    expect(p.text).toBe("Hi there");
    expect(p.attachments).toEqual([]);
  });

  it("finds the body inside mixed → related → alternative, with an inline image and a real attachment", () => {
    const tree = multi("mixed", [
      multi("related", [
        multi("alternative", [leaf("text/plain", "See logo"), leaf("text/html", '<p>See <img src="cid:logo@x"></p>')]),
        leaf("image/png", "PNG", { cid: "logo@x", disposition: "inline", filename: "logo.png" }),
      ]),
      leaf("application/pdf", "%PDF", { filename: "invoice.pdf", disposition: "attachment", attachmentId: "ATT1" }),
    ]);
    const p = parseMessage(message("m", tree));
    expect(p.html).toBe('<p>See <img src="cid:logo@x"></p>');
    expect(p.attachments).toEqual([
      { partId: "0.1", filename: "logo.png", mimeType: "image/png", size: 3, contentId: "logo@x", inline: true },
      { partId: "1", filename: "invoice.pdf", mimeType: "application/pdf", size: 4, contentId: null, inline: false },
    ]);
  });

  it("honours multipart/related's start parameter", () => {
    const tree = multi("related", [leaf("image/gif", "GIF", { cid: "img" }), leaf("text/html", "<p>root</p>", { cid: "root" })], '; start="<root>"');
    expect(parseMessage(message("m", tree)).html).toBe("<p>root</p>");
  });

  it("joins the body parts of a mixed message in order (e.g. a list footer)", () => {
    const p = parseMessage(message("m", multi("mixed", [leaf("text/plain", "Body"), leaf("text/plain", "-- footer")])));
    expect(p.text).toBe("Body\n\n-- footer");
    expect(p.html).toBeNull();
  });

  it("treats a text part with a filename, or marked attachment, as an attachment", () => {
    const p = parseMessage(message("m", multi("mixed", [leaf("text/plain", "Body"), leaf("text/plain", "a,b", { filename: "data.csv" }), leaf("text/html", "<p>x</p>", { disposition: "attachment" })])));
    expect(p.text).toBe("Body");
    expect(p.attachments.map((a) => a.filename)).toEqual(["data.csv", "attachment.html"]);
  });

  it("handles a message with no text part at all", () => {
    const p = parseMessage(message("m", multi("mixed", [leaf("image/jpeg", "JPG", { filename: "photo.jpg" })])));
    expect(p.html).toBeNull();
    expect(p.text).toBeNull();
    expect(p.attachments).toHaveLength(1);
  });
});

describe("parseMessage: decoding", () => {
  it("decodes each part's charset (Gmail has already undone base64 and quoted-printable)", () => {
    const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]); // "Café" in ISO-8859-1
    expect(parseMessage(message("m", leaf("text/plain", "", { charset: "ISO-8859-1", bytes: latin1 }))).text).toBe("Café");
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]); // "日本" in Shift_JIS
    expect(parseMessage(message("m", leaf("text/plain", "", { charset: "shift_jis", bytes: sjis }))).text).toBe("日本");
    expect(parseMessage(message("m", leaf("text/plain", "plain ascii =3D not QP"))).text).toBe("plain ascii =3D not QP");
  });

  it("falls back to UTF-8 for an unknown charset", () => {
    expect(parseMessage(message("m", leaf("text/plain", "héllo", { charset: "x-made-up" }))).text).toBe("héllo");
  });

  it("decodes RFC 2047 headers and filenames, and reads threading headers", () => {
    const m = message("m", multi("mixed", [leaf("text/plain", "x"), leaf("application/pdf", "%PDF", { filename: "=?UTF-8?Q?r=C3=A9sum=C3=A9.pdf?=" })]), [
      { name: "Subject", value: "=?UTF-8?B?8J+OiSBQYXJ0eQ==?=" },
      { name: "Cc", value: "Bob <bob@example.org>, cy@example.org" },
      { name: "Reply-To", value: "list@example.org" },
      { name: "References", value: "<a@x> <b@x>" },
    ]);
    const p = parseMessage(m);
    expect(p.subject).toBe("🎉 Party");
    expect(p.attachments[0]!.filename).toBe("résumé.pdf");
    expect(p.cc.map((a) => a.email)).toEqual(["bob@example.org", "cy@example.org"]);
    expect(p.replyTo).toEqual([{ name: "", email: "list@example.org" }]);
    expect(p.messageIdHeader).toBe("<m@mail.example.org>");
    expect(p.references).toEqual(["<a@x>", "<b@x>"]);
  });
});

describe("helpers", () => {
  it("findPart finds by partId", () => {
    const m = message("m", multi("mixed", [leaf("text/plain", "x"), multi("mixed", [leaf("image/png", "P")])]));
    expect(findPart(m.payload, "1.0")?.mimeType).toBe("image/png");
    expect(findPart(m.payload, "9")).toBeNull();
  });

  it("htmlToText keeps line structure and drops styles", () => {
    expect(htmlToText("<style>p{}</style><p>Hi&nbsp;Ann,</p><p>See <b>this</b>&amp;that<br>Bye</p><ul><li>one</li></ul>")).toBe("Hi Ann,\nSee this&that\nBye\n• one");
  });
});

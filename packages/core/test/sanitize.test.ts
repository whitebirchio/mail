import { describe, expect, it } from "vitest";
import { cleanCss, frameCsp, messageDocument, sanitizeEmailHtml, textToHtml } from "../src/message/sanitize";
import { FORBIDDEN_STRUCTURE, FORBIDDEN_VALUES, XSS, riskyValues, structureOf } from "./fixtures/xss";

const CIDS: Record<string, string> = { "logo@example": "/attachments/m1/att-logo" };
const opts = (allowRemoteImages = false) => ({ allowRemoteImages, cidUrl: (cid: string) => CIDS[cid] ?? null });

describe("sanitizeEmailHtml: the XSS corpus comes out inert", () => {
  for (const [name, html] of XSS) {
    it(name, () => {
      const { html: out } = sanitizeEmailHtml(html, opts(true));
      for (const bad of FORBIDDEN_STRUCTURE) expect(structureOf(out), `${name}: ${out}`).not.toMatch(bad);
      for (const bad of FORBIDDEN_VALUES) expect(riskyValues(out), `${name}: ${out}`).not.toMatch(bad);
    });
  }
});

describe("the corpus checks themselves", () => {
  it("would catch a live handler, a javascript: link or an iframe", () => {
    expect(structureOf('<img src="x" onerror="a()">')).toMatch(FORBIDDEN_STRUCTURE[2]!);
    expect(riskyValues('<a href="javascript:a()">')).toMatch(FORBIDDEN_VALUES[0]!);
    expect(structureOf("<iframe>")).toMatch(FORBIDDEN_STRUCTURE[1]!);
  });
});

describe("sanitizeEmailHtml: real-world email survives", () => {
  it("keeps layout: tables, inline styles, <style> blocks (child selectors intact) and fonts", () => {
    const html = `<html><head><style>.c > td { padding: 8px } @media (max-width:600px){.c{width:100%}}</style></head><body>
      <table class="c" width="600" cellpadding="0" bgcolor="#ffffff"><tr><td align="center" style="color:#333;font-size:16px"><font face="Arial">Your receipt</font></td></tr></table></body></html>`;
    const { html: out, blockedImages } = sanitizeEmailHtml(html, opts());
    expect(out).toContain("<style>.c > td { padding: 8px } @media (max-width:600px){.c{width:100%}}</style>");
    expect(out).toContain('<table class="c" width="600" cellpadding="0" bgcolor="#ffffff">');
    expect(out).toContain('style="color:#333;font-size:16px"');
    expect(out).toContain('<font face="Arial">Your receipt</font>');
    expect(blockedImages).toBe(0);
  });

  it("opens links in a new tab with no opener or referrer, overriding the sender's attributes", () => {
    const { html: out } = sanitizeEmailHtml(`<a href="https://example.org/a" target="_self" rel="opener">a</a> <a href="mailto:ann@example.org">m</a>`, opts());
    expect(out).toContain('<a href="https://example.org/a" target="_blank" rel="noopener noreferrer">a</a>');
    expect(out).toContain('<a href="mailto:ann@example.org" target="_blank" rel="noopener noreferrer">m</a>');
  });
});

describe("sanitizeEmailHtml: images", () => {
  const remote = `<img src="https://tracker.example/p.gif" width="1" alt="x"><td background="http://cdn.example/bg.jpg">t</td><div style="background:url('https://cdn.example/h.png') no-repeat">h</div><style>.h{background-image:url(https://cdn.example/s.png)}</style>`;

  it("holds back every kind of remote image until allowed, counting them", () => {
    const { html: out, blockedImages } = sanitizeEmailHtml(remote, opts(false));
    expect(out).not.toMatch(/https?:\/\/(tracker|cdn)\.example/);
    expect(out).toContain('<img width="1" alt="x" />');
    expect(blockedImages).toBe(4);
  });

  it("keeps them when allowed", () => {
    const { html: out, blockedImages } = sanitizeEmailHtml(remote, opts(true));
    expect(out).toContain('src="https://tracker.example/p.gif"');
    expect(out).toContain('background="http://cdn.example/bg.jpg"');
    expect(out).toContain("url(&quot;https://cdn.example/h.png&quot;)"); // HTML-escaped inside the attribute
    expect(out).toContain('url("https://cdn.example/s.png")');
    expect(blockedImages).toBe(0);
  });

  it("rewrites cid: to the attachment route, and drops unknown cids and non-image data URLs", () => {
    const { html: out } = sanitizeEmailHtml(
      `<img src="cid:logo@example"><img src="cid:%3Clogo@example%3E"><img src="cid:missing"><img src="data:image/png;base64,iVBORw0KGgo="><img src="data:text/html;base64,PHNjcmlwdD4=">`,
      opts(),
    );
    expect(out.match(/src="\/attachments\/m1\/att-logo"/g)).toHaveLength(2);
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out).not.toContain("cid:");
    expect(out).not.toContain("data:text/html");
  });
});

describe("cleanCss", () => {
  it("removes imports, expressions and bindings, and gates url()s", () => {
    let n = 0;
    const css = cleanCss("@import 'x.css'; a{width:expression(1);background:url(https://x.example/a.png)}", opts(), () => n++);
    expect(css).toBe(" a{width:(1);background:none}");
    expect(n).toBe(1);
  });
});

describe("textToHtml", () => {
  it("escapes, keeps whitespace and links URLs (without trailing punctuation)", () => {
    expect(textToHtml("<b>hi</b> see https://example.org/a?b=1&c=2.\n  > quoted")).toBe(
      '<div class="mail-text">&#60;b&#62;hi&#60;/b&#62; see <a href="https://example.org/a?b=1&#38;c=2" target="_blank" rel="noopener noreferrer">https://example.org/a?b=1&#38;c=2</a>.\n  &#62; quoted</div>',
    );
  });
});

describe("messageDocument", () => {
  it("carries its own CSP: nothing runs, and remote images only when allowed", () => {
    expect(frameCsp(false)).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src data:; form-action 'none'; base-uri 'none'");
    expect(frameCsp(true)).toContain("img-src 'self' data: https: http:");
    const doc = messageDocument("<p>x</p>", false);
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${frameCsp(false)}">`);
    expect(doc).toContain('<meta name="referrer" content="no-referrer">');
    expect(doc).not.toMatch(/script/i);
  });
});

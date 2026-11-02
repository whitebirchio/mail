import sanitizeHtml from "sanitize-html";

/**
 * Email HTML is untrusted input (SPEC.md, Security model 5). This is layer
 * (a): strip everything that can run or phone home, rewrite cid: references
 * to Mail's attachment route, and hold back remote images until asked.
 * Layer (b) is the sandboxed iframe with no allow-scripts, plus the CSP that
 * messageDocument() puts in its srcdoc, so a miss here still runs nothing.
 */

export interface SanitizeOptions {
  allowRemoteImages: boolean;
  /** A same-origin URL for an inline part's Content-ID, or null if the message has no such part. */
  cidUrl: (cid: string) => string | null;
}

export interface SanitizedHtml {
  html: string;
  /** Remote images (img, background, CSS url()) held back; the UI offers "Show images" when > 0. */
  blockedImages: number;
}

const TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "style",
  "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
];

const ATTRS: sanitizeHtml.IOptions["allowedAttributes"] = {
  "*": ["style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "color"],
  // target and rel are always overwritten by the transform below.
  a: ["href", "name", "target", "rel"],
  img: ["src", "alt", "border", "hspace", "vspace"],
  font: ["face", "size"],
  table: ["border", "cellpadding", "cellspacing", "background", "summary", "frame", "rules"],
  td: ["colspan", "rowspan", "background", "nowrap", "scope", "abbr", "headers"],
  th: ["colspan", "rowspan", "background", "nowrap", "scope", "abbr", "headers"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "type", "reversed"],
  ul: ["type"],
  li: ["value", "type"],
  time: ["datetime"],
};

const DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp|bmp);/i;
const REMOTE = /^https?:\/\//i;

type Verdict = { url: string } | { blocked: true } | { dropped: true };

/** Decide what an image-like URL becomes. */
function imageUrl(raw: string, o: SanitizeOptions): Verdict {
  const url = raw.trim();
  if (/^cid:/i.test(url)) {
    const mapped = o.cidUrl(decodeURIComponent(url.slice(4)).replace(/^<|>$/g, ""));
    return mapped ? { url: mapped } : { dropped: true };
  }
  if (DATA_IMAGE.test(url)) return { url };
  if (REMOTE.test(url)) return o.allowRemoteImages ? { url } : { blocked: true };
  return { dropped: true };
}

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gis;

/** Clean CSS from a style attribute or <style> block: no imports, bindings or expressions; url()s go through imageUrl. */
export function cleanCss(css: string, o: SanitizeOptions, onBlocked: () => void): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/-moz-binding|behavior\s*:/gi, "")
    .replace(/javascript:/gi, "")
    .replace(CSS_URL, (_m, _q: string, raw: string) => {
      const v = imageUrl(raw, o);
      if ("url" in v) return `url("${v.url.replace(/["\\\n\r]/g, "")}")`;
      if ("blocked" in v) onBlocked();
      return "none";
    });
}

export function sanitizeEmailHtml(html: string, o: SanitizeOptions): SanitizedHtml {
  let blockedImages = 0;
  const blocked = () => void blockedImages++;

  const out = sanitizeHtml(html, {
    allowedTags: TAGS,
    // <style> is needed for real-world email layout. It's safe here because
    // the result only ever renders in a script-less sandboxed frame.
    allowVulnerableTags: true,
    allowedAttributes: ATTRS,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite", "background"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tagName, attribs) => {
        const a = { ...attribs };
        if (a.style) a.style = cleanCss(a.style, o, blocked);
        if (a.background) {
          const v = imageUrl(a.background, o);
          if ("url" in v) a.background = v.url;
          else {
            if ("blocked" in v) blocked();
            delete a.background;
          }
        }
        if (tagName === "img" && a.src !== undefined) {
          const v = imageUrl(a.src, o);
          if ("url" in v) a.src = v.url;
          else {
            if ("blocked" in v) blocked();
            delete a.src;
          }
        }
        if (tagName === "a" && a.href) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        return { tagName, attribs: a };
      },
    },
  });

  // The parser closed each <style> at its first "</style", so these blocks
  // are whole; clean the CSS inside them the same way as style attributes.
  const cleaned = out.replace(/<style>([\s\S]*?)<\/style>/gi, (_m, css: string) => `<style>${cleanCss(css, o, blocked)}</style>`);
  return { html: cleaned, blockedImages };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LINK = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;

/** A plain-text body as HTML: escaped, whitespace kept, URLs linked. */
export function textToHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    out += escapeHtml(text.slice(last, m.index));
    const url = escapeHtml(m[0]);
    out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    last = m.index + m[0].length;
  }
  out += escapeHtml(text.slice(last));
  return `<div class="mail-text">${out}</div>`;
}

/** The frame's own policy. It stacks with the app's (srcdoc inherits it), so this can only narrow it. */
export function frameCsp(allowRemoteImages: boolean): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src 'self' data:${allowRemoteImages ? " https: http:" : ""}`,
    "font-src data:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** A whole srcdoc for one message body (already sanitized or converted from text). */
export function messageDocument(bodyHtml: string, allowRemoteImages: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCsp(allowRemoteImages)}"><meta name="referrer" content="no-referrer"><style>
html,body{margin:0;padding:0;background:#fff;color:#111}
body{padding:4px 2px;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}
img{max-width:100%}
.mail-text{white-space:pre-wrap;font-family:inherit}
a{color:#1a5fb4}
</style></head><body>${bodyHtml}</body></html>`;
}

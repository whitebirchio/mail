/**
 * Headers for serving a part's bytes from our origin. Attachments are
 * untrusted, so they never render as a page here: always
 * Content-Disposition: attachment (an <img> still displays inline images),
 * active types are served as octet-stream, and a sandbox CSP stops scripts
 * even if a browser renders the file anyway.
 */

/** The largest file Mail will stream. Revisited after T5's spike measures the Web Function's limit. */
export const MAX_DOWNLOAD_BYTES = 6 * 1024 * 1024;

const SAFE_TYPES = /^(image\/(png|jpeg|gif|webp|bmp|avif)|application\/pdf|text\/plain|text\/csv|text\/calendar|application\/zip|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/(msword|vnd\.[a-z0-9.+-]+))$/i;

export function safeContentType(mimeType: string): string {
  const t = mimeType.toLowerCase().split(";")[0]!.trim();
  return SAFE_TYPES.test(t) ? t : "application/octet-stream";
}

/** RFC 6266: an ASCII fallback plus the UTF-8 name. */
export function contentDisposition(filename: string): string {
  const name = (filename || "attachment").replace(/[\r\n"\\/]/g, "_");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function downloadHeaders(filename: string, mimeType: string, size: number): Record<string, string> {
  return {
    "content-type": safeContentType(mimeType),
    "content-disposition": contentDisposition(filename),
    "content-length": String(size),
    "content-security-policy": "sandbox; default-src 'none'",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "no-store",
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

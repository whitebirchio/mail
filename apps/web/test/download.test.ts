import { describe, expect, it } from "vitest";
import { contentDisposition, downloadHeaders, formatBytes, safeContentType } from "@/lib/download";

describe("attachment downloads", () => {
  it("never serves an active type as itself", () => {
    for (const t of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/javascript", "text/javascript", "application/x-shockwave-flash", "multipart/mixed"]) {
      expect(safeContentType(t), t).toBe("application/octet-stream");
    }
    expect(safeContentType("image/PNG; name=x")).toBe("image/png");
    expect(safeContentType("application/pdf")).toBe("application/pdf");
    expect(safeContentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("always downloads, sandboxed, uncached, with a safe filename", () => {
    const h = downloadHeaders('ré"sumé\r\n.pdf', "application/pdf", 10);
    expect(h["content-disposition"]).toBe(`attachment; filename="r__sum___.pdf"; filename*=UTF-8''r%C3%A9_sum%C3%A9__.pdf`);
    expect(h).toMatchObject({ "content-security-policy": "sandbox; default-src 'none'", "x-content-type-options": "nosniff", "cache-control": "no-store", "content-length": "10" });
    expect(contentDisposition("")).toContain('filename="attachment"');
    expect(contentDisposition("../../etc/passwd")).toContain('filename=".._.._etc_passwd"');
  });

  it("formats sizes", () => {
    expect([formatBytes(900), formatBytes(2048), formatBytes(5 * 1024 * 1024)]).toEqual(["900 B", "2 KB", "5.0 MB"]);
  });
});

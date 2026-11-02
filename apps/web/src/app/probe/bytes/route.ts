import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * TEMPORARY (T5 spike A): find the largest response that reaches the browser
 * intact through CloudFront and the Web Function. Answers only to a one-off
 * key whose hash is below; removed as soon as the limit is measured.
 */
const KEY_SHA256 = Buffer.from("dcdf1fc44e90e888c37cd3df40157546ec122f129e54e75e21af033b56572e6d", "hex");
const MAX_MB = 40;

export async function GET(req: Request) {
  const url = new URL(req.url, "http://x");
  const given = createHash("sha256").update(url.searchParams.get("key") ?? "").digest();
  if (!timingSafeEqual(given, KEY_SHA256)) return new NextResponse("Not found", { status: 404 });
  const mb = Math.min(MAX_MB, Math.max(0, Number(url.searchParams.get("mb") ?? "1")));
  const bytes = randomBytes(Math.round(mb * 1024 * 1024));
  const sha = createHash("sha256").update(bytes).digest("hex");
  return new NextResponse(bytes, { headers: { "content-type": "application/octet-stream", "x-probe-sha256": sha, "cache-control": "no-store", "content-length": String(bytes.length) } });
}

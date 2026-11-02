import { NextResponse } from "next/server";
import { signedIn } from "@/lib/auth";
import { MAX_DOWNLOAD_BYTES, downloadHeaders } from "@/lib/download";
import { mailboxFor } from "@/lib/gmail";

export const dynamic = "force-dynamic";

const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PART_ID = /^\d+(\.\d+)*$/;

/** A message part's bytes, through Mail so the browser never contacts Google (SPEC.md, Security model 6). */
export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string; partId: string }> }) {
  const { messageId, partId } = await params;
  if (!MESSAGE_ID.test(messageId) || !PART_ID.test(partId)) return new NextResponse("Not found", { status: 404 });
  const { config, session } = await signedIn();
  const r = await (await mailboxFor(config, session)).getAttachment(messageId, partId);
  if (!r.ok) {
    const status = r.error === "not-found" ? 404 : r.error === "auth" ? 401 : r.error === "rate-limited" ? 429 : 502;
    return new NextResponse("Couldn't fetch that attachment from Gmail.", { status, headers: { "cache-control": "no-store" } });
  }
  const { bytes, filename, mimeType } = r.value;
  if (bytes.length > MAX_DOWNLOAD_BYTES) return new NextResponse("That file is too large to download through Mail.", { status: 413, headers: { "cache-control": "no-store" } });
  return new NextResponse(Buffer.from(bytes), { status: 200, headers: downloadHeaders(filename, mimeType, bytes.length) });
}

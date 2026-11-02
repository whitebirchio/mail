"use server";

import { type SendResult, sendMail } from "@mail/core";
import { revalidatePath } from "next/cache";
import { signedIn } from "@/lib/auth";
import { mailboxFor } from "@/lib/gmail";
import { assertOrigin } from "@/lib/origin";

export type SendState = { status: "idle" } | { status: "sent" } | { status: "error"; message: string; field?: "to" | "cc" | "bcc" };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PART = /^\d+(\.\d+)*$/;
const text = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").slice(0, max);

const MESSAGES: Partial<Record<Exclude<SendResult, { ok: true }>["error"], string>> = {
  "no-recipients": "Add at least one recipient.",
  "too-large": "The forwarded attachments are over Gmail's 25 MB limit. Untick some and try again.",
  "rate-limited": "Gmail is busy. Try again in a few seconds.",
  unavailable: "Couldn't reach Gmail. Your message wasn't sent; try again.",
  auth: "Your sign-in expired. Copy your text, then reload to sign in again.",
  "not-found": "A forwarded attachment no longer exists. Untick it and try again.",
};

/** Send from the compose form (SPEC.md, story 7). */
export async function sendAction(_prev: SendState, form: FormData): Promise<SendState> {
  const { config, session } = await signedIn();
  await assertOrigin(config);
  const mailbox = await mailboxFor(config, session);

  const threadId = text(form, "threadId", 64);
  let references: string[] = [];
  try {
    const parsed: unknown = JSON.parse(text(form, "references", 20_000) || "[]");
    if (Array.isArray(parsed)) references = parsed.filter((r): r is string => typeof r === "string").slice(-20);
  } catch {
    references = [];
  }
  const forward = form
    .getAll("forward")
    .map(String)
    .map((v) => v.split(":"))
    .filter(([m, p]) => m && p && ID.test(m) && PART.test(p))
    .map(([messageId, partId]) => ({ messageId: messageId!, partId: partId! }));

  const identity = await mailbox.sender();
  const from = identity.ok ? identity.value : { email: session.email, name: "" };
  const result = await sendMail(
    mailbox,
    {
      to: text(form, "to", 10_000),
      cc: text(form, "cc", 10_000),
      bcc: text(form, "bcc", 10_000),
      subject: text(form, "subject", 900),
      body: text(form, "body", 1_000_000),
      threadId: ID.test(threadId) ? threadId : null,
      inReplyTo: text(form, "inReplyTo", 1000) || null,
      references,
      forward,
    },
    from,
    new Date(),
  );

  if (result.ok) {
    console.log(JSON.stringify({ level: "info", message: "sent", threaded: Boolean(threadId), attachments: forward.length }));
    revalidatePath("/", "layout");
    return { status: "sent" };
  }
  console.log(JSON.stringify({ level: "warn", message: "send failed", error: result.error }));
  if (result.error === "invalid-recipients") {
    return { status: "error", field: result.field, message: `${result.field === "to" ? "To" : result.field === "cc" ? "Cc" : "Bcc"}: ${result.invalid.join(", ")} ${result.invalid.length === 1 ? "isn't a valid address" : "aren't valid addresses"}.` };
  }
  return { status: "error", message: MESSAGES[result.error] ?? "Something went wrong. Your message wasn't sent." };
}

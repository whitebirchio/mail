import { type Original, composeDefaults, isComposeMode, parseMessage } from "@mail/core";
import { ComposeForm } from "@/components/compose-form";
import { ErrorPanel } from "@/components/thread-list-page";
import { signedIn } from "@/lib/auth";
import { safeBack } from "@/lib/boxes";
import { formatBytes } from "@/lib/download";
import { ERROR_TEXT, mailboxFor, onMailboxError } from "@/lib/gmail";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEADINGS = { new: "New message", reply: "Reply", replyAll: "Reply all", forward: "Forward" } as const;

export default async function ComposePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const mode = isComposeMode(sp.mode) ? sp.mode : "new";
  const back = safeBack(sp.back);
  const { config, session } = await signedIn();

  let original: Original | null = null;
  if (mode !== "new") {
    if (!sp.t || !sp.m || !ID.test(sp.t) || !ID.test(sp.m)) return <ErrorPanel title={HEADINGS[mode]} message="That message link is incomplete." retry={back} />;
    const thread = await (await mailboxFor(config, session)).getThread(sp.t);
    if (!thread.ok) {
      onMailboxError(thread.error);
      return <ErrorPanel title={HEADINGS[mode]} message={ERROR_TEXT[thread.error]} retry={back} />;
    }
    const m = thread.value.messages.find((x) => x.id === sp.m);
    if (!m) return <ErrorPanel title={HEADINGS[mode]} message={ERROR_TEXT["not-found"]} retry={back} />;
    original = { messageId: m.id, threadId: m.threadId, parsed: parseMessage(m), internalDate: m.internalDate };
  }

  const d = composeDefaults(mode, original, config.ownerEmail);
  return (
    <ComposeForm
      heading={HEADINGS[mode]}
      back={back}
      initial={{ to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body }}
      threadId={d.threadId}
      inReplyTo={d.inReplyTo}
      references={d.references}
      forwardAttachments={d.forwardAttachments.map((a) => ({ value: `${a.messageId}:${a.partId}`, filename: a.filename, size: formatBytes(a.size) }))}
      focus={mode === "reply" || mode === "replyAll" ? "body" : "to"}
    />
  );
}

import { formatAddress, threadView, triage } from "@mail/core";
import { notFound } from "next/navigation";
import { MessageCard, type MessageCardData } from "@/components/message-card";
import { RefreshOnce } from "@/components/refresh-once";
import { ThreadToolbar } from "@/components/thread-toolbar";
import { ErrorPanel } from "@/components/thread-list-page";
import { signedIn } from "@/lib/auth";
import { safeBack } from "@/lib/boxes";
import { MAX_DOWNLOAD_BYTES, formatBytes } from "@/lib/download";
import { ERROR_TEXT, mailboxFor, onMailboxError } from "@/lib/gmail";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function ThreadPage({ params, searchParams }: { params: Promise<{ threadId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { threadId } = await params;
  if (!ID.test(threadId)) notFound();
  const sp = await searchParams;
  const back = safeBack(sp.back);
  const after = (sp.after ?? "").split(",").filter((id) => ID.test(id));
  const images = (sp.images ?? "").split(",").filter((id) => id === "all" || ID.test(id));

  const { config, session } = await signedIn();
  const mailbox = await mailboxFor(config, session);
  const thread = await mailbox.getThread(threadId);
  if (!thread.ok) {
    onMailboxError(thread.error);
    return <ErrorPanel title="Conversation" message={ERROR_TEXT[thread.error]} retry={back} />;
  }

  const view = threadView(thread.value, {
    ownerEmail: config.ownerEmail,
    showImages: (id) => images.includes("all") || images.includes(id),
    attachmentUrl: (m, p) => `/attachments/${encodeURIComponent(m)}/${p}`,
  });
  // Opening a thread marks it read: the one GET with a side effect (SPEC.md, story 5).
  const wasUnread = view.unread;
  if (wasUnread) {
    const r = await triage(mailbox, [threadId], "read");
    if (!r.ok) console.log(JSON.stringify({ level: "warn", message: "mark read on open failed", error: r.error }));
  }

  const here = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ back, ...(after.length ? { after: after.join(",") } : {}), ...extra });
    return `/t/${threadId}?${q}`;
  };
  const selfHref = here(images.length ? { images: images.join(",") } : {});
  const owner = config.ownerEmail.toLowerCase();
  const cards: MessageCardData[] = view.messages.map((m) => {
    const others = [...m.to, ...m.cc].filter((a) => a.email.toLowerCase() !== owner);
    const compose = (mode: string) => `/compose?${new URLSearchParams({ mode, t: threadId, m: m.id, back: selfHref })}`;
    return {
      id: m.id,
      fromName: m.fromName,
      fromEmail: m.from?.email ?? "",
      recipients: [m.to.length ? `to ${m.to.map(formatAddress).join(", ")}` : "", m.cc.length ? `cc ${m.cc.map(formatAddress).join(", ")}` : ""].filter(Boolean).join(" · "),
      date: m.date,
      snippet: m.snippet,
      unread: m.unread,
      draft: m.draft,
      expanded: m.expanded,
      document: m.document,
      blockedImages: m.blockedImages,
      imagesShown: m.imagesShown,
      showImagesHref: here({ images: [...images, m.id].join(",") }),
      canReplyAll: others.length > 1 || (others.length === 1 && m.from?.email.toLowerCase() !== others[0]!.email.toLowerCase()),
      compose: { reply: compose("reply"), replyAll: compose("replyAll"), forward: compose("forward") },
      attachments: m.attachments.map((a) => ({ partId: a.partId, filename: a.filename, size: formatBytes(a.size), url: a.url, tooLarge: a.size > MAX_DOWNLOAD_BYTES })),
    };
  });

  return (
    <article aria-labelledby="thread-subject" className="flex flex-col">
      {wasUnread && <RefreshOnce />}
      <ThreadToolbar threadId={threadId} labelIds={view.labelIds} back={back} after={after} />
      <h1 id="thread-subject" className="px-4 pt-4 pb-2 text-xl font-normal">
        {view.subject || "(no subject)"}
      </h1>
      <ul className="flex flex-col">
        {cards.map((c) => (
          <MessageCard key={c.id} m={c} subject={view.subject} />
        ))}
      </ul>
    </article>
  );
}

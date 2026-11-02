"use client";

import { Forward, ImageOff, Paperclip, Reply, ReplyAll } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LocalTime } from "./local-time";
import { MessageFrame } from "./message-frame";

/** What the client needs of a MessageView: no raw bodies. */
export interface MessageCardData {
  id: string;
  fromName: string;
  fromEmail: string;
  recipients: string;
  date: number;
  snippet: string;
  unread: boolean;
  draft: boolean;
  expanded: boolean;
  document: string;
  blockedImages: number;
  imagesShown: boolean;
  showImagesHref: string;
  canReplyAll: boolean;
  compose: Record<"reply" | "replyAll" | "forward", string>;
  attachments: { partId: string; filename: string; size: string; url: string; tooLarge: boolean }[];
}

export function MessageCard({ m, subject }: { m: MessageCardData; subject: string }) {
  const [open, setOpen] = useState(m.expanded);
  const header = (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className={`truncate ${m.unread ? "font-semibold" : "font-medium"}`}>{m.fromName}</span>
      {m.draft && <span className="text-xs text-[var(--bad)]">Draft</span>}
      {open ? <span className="hidden truncate text-xs text-[var(--muted)] sm:inline">&lt;{m.fromEmail}&gt;</span> : <span className="truncate text-sm text-[var(--muted)]">{m.snippet}</span>}
    </span>
  );

  if (!open) {
    return (
      <li className="border-b border-[var(--border)]">
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-[var(--surface)]">
          {header}
          <LocalTime ms={m.date} className="shrink-0 text-xs text-[var(--muted)]" />
        </button>
      </li>
    );
  }

  return (
    <li className="border-b border-[var(--border)] px-4 py-3">
      <button type="button" onClick={() => setOpen(false)} aria-expanded className="flex w-full items-center gap-3 text-left text-sm">
        {header}
        <LocalTime ms={m.date} long className="shrink-0 text-xs text-[var(--muted)]" />
      </button>
      {m.recipients && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{m.recipients}</p>}

      {m.blockedImages > 0 && !m.imagesShown && (
        <p className="mt-3 flex items-center gap-2 rounded-md bg-[var(--surface)] px-3 py-2 text-xs text-[var(--muted)]">
          <ImageOff className="size-4 shrink-0" aria-hidden />
          Images from the sender are hidden, so they can&apos;t tell you opened this.
          <Link href={m.showImagesHref} className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline" scroll={false}>
            Show images
          </Link>
        </p>
      )}

      <div className="mt-3">
        <MessageFrame document={m.document} title={`Message from ${m.fromName}: ${subject}`} />
      </div>

      {m.attachments.length > 0 && (
        <ul aria-label="Attachments" className="mt-3 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <li key={a.partId}>
              {a.tooLarge ? (
                <span className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]" title="Too large to download through Mail. Open it on your phone.">
                  <Paperclip className="size-4" aria-hidden />
                  {a.filename} · {a.size} · too large here
                </span>
              ) : (
                <a href={a.url} download className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs hover:bg-[var(--surface)]">
                  <Paperclip className="size-4" aria-hidden />
                  <span className="max-w-60 truncate">{a.filename}</span>
                  <span className="text-[var(--muted)]">{a.size}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {!m.draft && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ComposeLink href={m.compose.reply} icon={<Reply className="size-4" aria-hidden />} label="Reply" />
          {m.canReplyAll && <ComposeLink href={m.compose.replyAll} icon={<ReplyAll className="size-4" aria-hidden />} label="Reply all" />}
          <ComposeLink href={m.compose.forward} icon={<Forward className="size-4" aria-hidden />} label="Forward" />
        </div>
      )}
    </li>
  );
}

function ComposeLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--surface)]">
      {icon}
      {label}
    </Link>
  );
}

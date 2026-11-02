"use client";

import { REMOVES_FROM_VIEW, type ThreadRow, type Triage, peopleLine } from "@mail/core";
import { AlertOctagon, Archive, ArchiveRestore, Inbox, Mail, MailOpen, Paperclip, RotateCcw, ShieldCheck, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { LocalTime } from "./local-time";
import { useToast } from "./toast";
import { runTriage } from "./triage";

type Kind = "inbox" | "spam" | "trash" | "other";
type Action = { verb: Triage; label: string; icon: React.ComponentType<{ className?: string }>; key?: string };

/** The bulk toolbar's verbs for each kind of list. */
const BULK: Record<Kind, Action[]> = {
  inbox: [
    { verb: "archive", label: "Archive", icon: Archive, key: "e" },
    { verb: "spam", label: "Report spam", icon: AlertOctagon, key: "!" },
    { verb: "trash", label: "Delete", icon: Trash2, key: "#" },
  ],
  spam: [
    { verb: "notSpam", label: "Not spam", icon: ShieldCheck },
    { verb: "trash", label: "Delete", icon: Trash2, key: "#" },
  ],
  trash: [{ verb: "untrash", label: "Restore", icon: RotateCcw }],
  other: [
    { verb: "inbox", label: "Move to Inbox", icon: Inbox },
    { verb: "archive", label: "Archive", icon: Archive, key: "e" },
    { verb: "trash", label: "Delete", icon: Trash2, key: "#" },
  ],
};

export function threadHref(id: string, back: string, after: string[]) {
  const q = new URLSearchParams({ back });
  if (after.length > 0) q.set("after", after.slice(0, 25).join(","));
  return `/t/${encodeURIComponent(id)}?${q}`;
}

export function ThreadList({ rows, kind, inSent, back, emptyText }: { rows: ThreadRow[]; kind: Kind; inSent: boolean; back: string; emptyText: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const toast = useToast();
  const visible = new Set(rows.map((r) => r.id));
  const chosen = [...selected].filter((id) => visible.has(id));
  const all = rows.length > 0 && chosen.length === rows.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const act = (ids: string[], verb: Triage) =>
    start(async () => {
      const r = await runTriage(ids, verb, toast, { undoable: REMOVES_FROM_VIEW.has(verb) });
      if (r.ok) setSelected(new Set());
    });

  if (rows.length === 0) return <p className="px-4 py-16 text-center text-sm text-[var(--muted)]">{emptyText}</p>;

  return (
    <div className="flex flex-col" aria-busy={pending}>
      <div role="toolbar" aria-label="Selected conversations" className="flex h-11 items-center gap-1 border-b border-[var(--border)] px-3 md:px-2">
        <input
          type="checkbox"
          aria-label={all ? "Select none" : "Select all on this page"}
          className="mx-2 size-4 accent-[var(--accent)]"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = chosen.length > 0 && !all;
          }}
          onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
        />
        {chosen.length > 0 && (
          <>
            {BULK[kind].map((a) => (
              <IconButton key={a.verb} label={a.label} shortcut={a.key} disabled={pending} onClick={() => act(chosen, a.verb)}>
                <a.icon className="size-4" />
              </IconButton>
            ))}
            <IconButton label="Mark as read" shortcut="I" disabled={pending} onClick={() => act(chosen, "read")}>
              <MailOpen className="size-4" />
            </IconButton>
            <IconButton label="Mark as unread" shortcut="U" disabled={pending} onClick={() => act(chosen, "unread")}>
              <Mail className="size-4" />
            </IconButton>
            <span className="ml-2 text-xs text-[var(--muted)]">{chosen.length} selected</span>
          </>
        )}
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r, i) => (
          <Row
            key={r.id}
            row={r}
            inSent={inSent}
            kind={kind}
            href={threadHref(
              r.id,
              back,
              rows.slice(i + 1).map((x) => x.id),
            )}
            checked={selected.has(r.id)}
            onCheck={() => toggle(r.id)}
            act={act}
            pending={pending}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  row,
  inSent,
  kind,
  href,
  checked,
  onCheck,
  act,
  pending,
}: {
  row: ThreadRow;
  inSent: boolean;
  kind: Kind;
  href: string;
  checked: boolean;
  onCheck: () => void;
  act: (ids: string[], verb: Triage) => void;
  pending: boolean;
}) {
  const people = peopleLine(row, inSent);
  const subject = row.subject || "(no subject)";
  const strong = row.unread ? "font-semibold text-[var(--text)]" : "";
  const quick = kind === "inbox" ? { verb: "archive" as const, label: "Archive", Icon: Archive } : kind === "trash" ? { verb: "untrash" as const, label: "Restore", Icon: ArchiveRestore } : null;

  return (
    <li className={`group relative flex items-center gap-1 px-3 md:px-2 ${checked ? "bg-[var(--accent-soft)]" : row.unread ? "bg-[var(--raised)]" : ""} hover:shadow-[inset_0_-1px_0_var(--border),0_1px_2px_rgba(0,0,0,0.08)]`}>
      <input type="checkbox" className="relative z-10 mx-2 size-4 accent-[var(--accent)]" checked={checked} onChange={onCheck} aria-label={`Select: ${people}, ${subject}`} />
      <button
        type="button"
        className="relative z-10 rounded-full p-1.5 hover:bg-[var(--surface)]"
        aria-pressed={row.starred}
        aria-label={row.starred ? "Unstar" : "Star"}
        data-shortcut="s"
        disabled={pending}
        onClick={() => act([row.id], row.starred ? "unstar" : "star")}
      >
        <Star className={`size-4 ${row.starred ? "fill-[var(--star)] text-[var(--star)]" : "text-[var(--muted)]"}`} />
      </button>
      <Link href={href} className="flex min-w-0 flex-1 flex-col gap-0.5 py-2.5 pl-1 text-sm text-[var(--muted)] md:flex-row md:items-center md:gap-4 md:py-2">
        <span className="flex items-center justify-between gap-2 md:w-52 md:shrink-0">
          <span className={`truncate ${strong || "text-[var(--text)]"}`}>
            {people}
            {row.count > 1 && <span className="ml-1 text-xs font-normal text-[var(--muted)]">{row.count}</span>}
            {row.draft && !inSent && <span className="ml-1 text-xs font-normal text-[var(--bad)]">Draft</span>}
          </span>
          <LocalTime ms={row.date} className={`shrink-0 text-xs md:hidden ${strong}`} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className={strong || "text-[var(--text)]"}>{subject}</span>
          {row.snippet && <span> — {row.snippet}</span>}
        </span>
        {row.attachment && <Paperclip className="hidden size-4 shrink-0 md:block" aria-label="Has attachment" />}
        <LocalTime ms={row.date} className={`hidden w-16 shrink-0 text-right text-xs md:block md:group-hover:invisible ${strong}`} />
      </Link>
      <div className="absolute right-2 z-10 hidden items-center gap-0.5 md:group-hover:flex">
        {quick && (
          <IconButton label={quick.label} shortcut={quick.verb === "archive" ? "e" : undefined} disabled={pending} onClick={() => act([row.id], quick.verb)}>
            <quick.Icon className="size-4" />
          </IconButton>
        )}
        {kind !== "trash" && (
          <IconButton label="Delete" shortcut="#" disabled={pending} onClick={() => act([row.id], "trash")}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
        <IconButton label={row.unread ? "Mark as read" : "Mark as unread"} shortcut={row.unread ? "I" : "U"} disabled={pending} onClick={() => act([row.id], row.unread ? "read" : "unread")}>
          {row.unread ? <MailOpen className="size-4" /> : <Mail className="size-4" />}
        </IconButton>
      </div>
    </li>
  );
}

export function IconButton({ label, onClick, disabled, shortcut, children }: { label: string; onClick: () => void; disabled?: boolean; shortcut?: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} data-shortcut={shortcut} disabled={disabled} onClick={onClick} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:opacity-50">
      {children}
    </button>
  );
}

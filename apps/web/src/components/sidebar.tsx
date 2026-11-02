"use client";

import { AlertOctagon, Archive, File, Inbox, Menu, PenSquare, Send, Star, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SYSTEM_BOXES } from "@/lib/boxes";

const ICONS: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  inbox: Inbox,
  starred: Star,
  sent: Send,
  drafts: File,
  all: Archive,
  spam: AlertOctagon,
  trash: Trash2,
};

export interface SidebarProps {
  inboxUnread: number;
  labels: { id: string; name: string }[];
}

function Nav({ inboxUnread, labels, onNavigate }: SidebarProps & { onNavigate?: () => void }) {
  const path = usePathname();
  const item = (href: string, active: boolean) =>
    `flex items-center gap-3 rounded-r-full py-1.5 pl-5 pr-3 text-sm ${active ? "bg-[var(--accent-soft)] font-semibold" : "hover:bg-[var(--surface)]"}`;
  return (
    <nav aria-label="Mailboxes" className="flex flex-col gap-0.5 pr-2">
      {SYSTEM_BOXES.map((b) => {
        const Icon = ICONS[b.slug]!;
        const active = path === `/${b.slug}`;
        const count = b.slug === "inbox" && inboxUnread > 0 ? inboxUnread : null;
        return (
          <Link key={b.slug} href={`/${b.slug}`} className={item(b.slug, active)} aria-current={active ? "page" : undefined} onClick={onNavigate}>
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{b.title}</span>
            {count !== null && (
              <span className="text-xs font-semibold" aria-label={`${count} unread`}>
                {count}
              </span>
            )}
          </Link>
        );
      })}
      {labels.length > 0 && (
        <>
          <h2 className="mt-4 mb-1 pl-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Labels</h2>
          {labels.map((l) => {
            const href = `/label/${encodeURIComponent(l.id)}`;
            const active = path === href;
            return (
              <Link key={l.id} href={href} className={item(href, active)} aria-current={active ? "page" : undefined} onClick={onNavigate}>
                <Tag className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{l.name}</span>
              </Link>
            );
          })}
        </>
      )}
    </nav>
  );
}

export function ComposeButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/compose?mode=new"
      data-shortcut="c"
      title="Compose (c)"
      className={`inline-flex items-center gap-2 rounded-2xl bg-[var(--accent-soft)] px-5 py-3 text-sm font-semibold shadow-sm hover:shadow ${className}`}
    >
      <PenSquare className="size-4" aria-hidden />
      Compose
    </Link>
  );
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-4 py-2 md:flex">
      <div className="pl-3">
        <ComposeButton />
      </div>
      <Nav {...props} />
    </aside>
  );
}

/** Below md the sidebar is a menu. */
export function MobileNav(props: SidebarProps) {
  return (
    <details className="group md:hidden">
      <summary className="flex cursor-pointer list-none items-center rounded-full p-2 hover:bg-[var(--surface)]" aria-label="Menu">
        <Menu className="size-5" aria-hidden />
      </summary>
      <div className="absolute left-0 right-0 top-14 z-40 border-b border-[var(--border)] bg-[var(--background)] pb-3 shadow-lg">
        <div className="p-3">
          <ComposeButton />
        </div>
        <Nav {...props} onNavigate={() => document.querySelector<HTMLDetailsElement>("details[open]")?.removeAttribute("open")} />
      </div>
    </details>
  );
}

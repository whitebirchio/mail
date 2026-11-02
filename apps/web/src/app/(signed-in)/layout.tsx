import { LogOut, Search } from "lucide-react";
import { Shortcuts } from "@/components/shortcuts";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";
import { signedIn } from "@/lib/auth";
import { SYSTEM_BOXES } from "@/lib/boxes";
import { mailboxFor, onMailboxError } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const { config, session } = await signedIn();
  const mailbox = await mailboxFor(config, session);
  const labels = await mailbox.listLabels();
  if (!labels.ok) onMailboxError(labels.error);
  const all = labels.ok ? labels.value : [];
  const system = new Set(SYSTEM_BOXES.map((b) => b.labelId));
  const props = {
    inboxUnread: all.find((l) => l.id === "INBOX")?.unreadThreads ?? 0,
    labels: all
      .filter((l) => l.type === "user" && !system.has(l.id))
      .map((l) => ({ id: l.id, name: l.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  return (
    <ToastProvider>
      <Shortcuts />
      <title>{props.inboxUnread > 0 ? `Inbox (${props.inboxUnread}) · Mail` : "Mail"}</title>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--border)] bg-[var(--background)] px-2 md:gap-4 md:px-4">
          <MobileNav {...props} />
          <a href="/inbox" className="hidden w-52 pl-3 text-lg font-semibold md:block">
            Mail
          </a>
          <form action="/search" method="get" role="search" className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[var(--surface)] px-4 py-2 md:max-w-2xl">
            <Search className="size-4 shrink-0 text-[var(--muted)]" aria-hidden />
            <label htmlFor="q" className="sr-only">
              Search mail
            </label>
            <input id="q" name="q" type="search" placeholder="Search mail (Gmail syntax works)" className="w-full min-w-0 bg-transparent text-sm outline-none" autoComplete="off" />
          </form>
          <form method="post" action="/auth/logout" className="ml-auto shrink-0">
            <button type="submit" className="flex items-center gap-2 rounded-full p-2 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]" title={`Signed in as ${session.email}. Sign out`}>
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only md:not-sr-only">Sign out</span>
            </button>
          </form>
        </header>
        <div className="flex flex-1">
          <Sidebar {...props} />
          <main className="min-w-0 flex-1 md:pr-4">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

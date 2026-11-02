import { PAGE_SIZE, threadRow } from "@mail/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { signedIn } from "@/lib/auth";
import { ERROR_TEXT, mailboxFor, onMailboxError } from "@/lib/gmail";
import { AutoRefresh } from "./auto-refresh";
import { ThreadList } from "./thread-list";

export interface ListSpec {
  title: string;
  /** This list's own path, used to build page links and each thread's "back". */
  path: string;
  labelId?: string;
  q?: string;
  /** Which triage verbs the toolbar offers here. */
  kind: "inbox" | "spam" | "trash" | "other";
  inSent?: boolean;
}

const MAX_PAGES = 40;

/** Older/newer page tokens live in the URL as a stack (?p=…&p=…): Gmail only gives "next". */
export async function ThreadListPage({ spec, searchParams }: { spec: ListSpec; searchParams: Record<string, string | string[] | undefined> }) {
  const stack = ([] as string[]).concat(searchParams.p ?? []).filter((t) => /^[A-Za-z0-9_-]{1,200}$/.test(t)).slice(0, MAX_PAGES);
  const { config, session } = await signedIn();
  const mailbox = await mailboxFor(config, session);
  const page = await mailbox.listThreads({ labelId: spec.labelId, q: spec.q, pageToken: stack.at(-1) });
  if (!page.ok) {
    onMailboxError(page.error);
    return <ErrorPanel title={spec.title} message={ERROR_TEXT[page.error]} retry={spec.path} />;
  }

  const rows = page.value.threads.map((t) => threadRow(t, config.ownerEmail));
  const withPages = (tokens: string[]) => {
    const u = new URL(spec.path, "http://x");
    for (const t of tokens) u.searchParams.append("p", t);
    return u.pathname + u.search;
  };
  const here = withPages(stack);
  const first = stack.length * PAGE_SIZE + 1;
  const last = stack.length * PAGE_SIZE + rows.length;
  const newer = stack.length > 0 ? withPages(stack.slice(0, -1)) : null;
  const older = page.value.nextPageToken ? withPages([...stack, page.value.nextPageToken]) : null;

  return (
    <section aria-labelledby="list-title" className="flex flex-col">
      <AutoRefresh />
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1 md:px-2">
        <h1 id="list-title" className="truncate text-base font-semibold">
          {spec.q !== undefined ? <>Results for &ldquo;{spec.q}&rdquo;</> : spec.title}
        </h1>
        <div className="flex shrink-0 items-center gap-1 text-xs text-[var(--muted)]">
          {rows.length > 0 && (
            <span>
              {first}–{last}
              {page.value.nextPageToken ? ` of ${page.value.resultSizeEstimate > last ? `about ${page.value.resultSizeEstimate}` : "many"}` : ` of ${last}`}
            </span>
          )}
          <PageLink href={newer} label="Newer">
            <ChevronLeft className="size-4" aria-hidden />
          </PageLink>
          <PageLink href={older} label="Older">
            <ChevronRight className="size-4" aria-hidden />
          </PageLink>
        </div>
      </div>
      <ThreadList rows={rows} kind={spec.kind} inSent={spec.inSent ?? false} back={here} emptyText={spec.q !== undefined ? "No conversations match that search." : `Nothing in ${spec.title}.`} />
    </section>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "rounded-full p-1.5";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={`${cls} hover:bg-[var(--surface)] hover:text-[var(--text)]`}>
      {children}
    </Link>
  ) : (
    <span aria-hidden className={`${cls} opacity-40`}>
      {children}
    </span>
  );
}

export function ErrorPanel({ title, message, retry }: { title: string; message: string; retry: string }) {
  return (
    <section className="p-6">
      <h1 className="text-base font-semibold">{title}</h1>
      <p role="alert" className="mt-3 max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        {message}{" "}
        <a href={retry} className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline">
          Try again
        </a>
      </p>
    </section>
  );
}

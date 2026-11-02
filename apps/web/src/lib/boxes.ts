/** The sidebar's system boxes (SPEC.md, story 3): URL slug → Gmail label and title. */
export interface Box {
  slug: string;
  /** Gmail label to list; undefined = All Mail (everything but spam and trash). */
  labelId?: string;
  title: string;
}

export const SYSTEM_BOXES: Box[] = [
  { slug: "inbox", labelId: "INBOX", title: "Inbox" },
  { slug: "starred", labelId: "STARRED", title: "Starred" },
  { slug: "sent", labelId: "SENT", title: "Sent" },
  { slug: "drafts", labelId: "DRAFT", title: "Drafts" },
  { slug: "all", title: "All Mail" },
  { slug: "spam", labelId: "SPAM", title: "Spam" },
  { slug: "trash", labelId: "TRASH", title: "Trash" },
];

export const boxBySlug = (slug: string) => SYSTEM_BOXES.find((b) => b.slug === slug) ?? null;

/** Where a list lives: /inbox, /label/<id>, or /search?q=. */
export const boxPath = (b: { slug?: string; labelId?: string; q?: string }) =>
  b.q !== undefined ? `/search?q=${encodeURIComponent(b.q)}` : b.slug ? `/${b.slug}` : `/label/${encodeURIComponent(b.labelId ?? "")}`;

/** Only same-app paths are allowed as a "back" target, never another origin. */
export function safeBack(raw: string | null | undefined, fallback = "/inbox"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}

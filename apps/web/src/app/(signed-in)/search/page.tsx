import { redirect } from "next/navigation";
import { ThreadListPage } from "@/components/thread-list-page";

export const dynamic = "force-dynamic";

/** Gmail's own query syntax, passed through (SPEC.md, story 4). */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 500);
  if (!q) redirect("/inbox");
  return <ThreadListPage spec={{ title: "Search", path: `/search?q=${encodeURIComponent(q)}`, q, kind: "other" }} searchParams={sp} />;
}

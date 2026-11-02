import { notFound } from "next/navigation";
import { ThreadListPage } from "@/components/thread-list-page";
import { boxBySlug } from "@/lib/boxes";

export const dynamic = "force-dynamic";

export default async function BoxPage({ params, searchParams }: { params: Promise<{ box: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const box = boxBySlug((await params).box);
  if (!box) notFound();
  const kind = box.slug === "inbox" ? "inbox" : box.slug === "spam" ? "spam" : box.slug === "trash" ? "trash" : "other";
  return <ThreadListPage spec={{ title: box.title, path: `/${box.slug}`, labelId: box.labelId, kind, inSent: box.slug === "sent" || box.slug === "drafts" }} searchParams={await searchParams} />;
}

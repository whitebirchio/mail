import { notFound } from "next/navigation";
import { ThreadListPage } from "@/components/thread-list-page";
import { signedIn } from "@/lib/auth";
import { mailboxFor } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export default async function LabelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = decodeURIComponent((await params).id);
  const { config, session } = await signedIn();
  const labels = await (await mailboxFor(config, session)).listLabels();
  const label = labels.ok ? labels.value.find((l) => l.id === id && l.type === "user") : undefined;
  if (!label) notFound();
  return <ThreadListPage spec={{ title: label.name, path: `/label/${encodeURIComponent(id)}`, labelId: id, kind: "other" }} searchParams={await searchParams} />;
}

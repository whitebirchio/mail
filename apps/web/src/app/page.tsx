import { signedIn } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { session } = await signedIn();
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold">Mail</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">Signed in as {session.email}.</p>
      <form method="post" action="/auth/logout" className="mt-4">
        <button type="submit" className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--surface)]">
          Sign out
        </button>
      </form>
    </main>
  );
}

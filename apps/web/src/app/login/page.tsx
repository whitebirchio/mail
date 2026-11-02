export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <title>Sign in · Mail</title>
      <div>
        <h1 className="text-2xl font-semibold">Mail</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Private mailbox. Sign in with the owner&apos;s Google account.</p>
      </div>
      {expired && (
        <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          Your Google sign-in expired or was revoked. Sign in again to continue.
        </p>
      )}
      <a href="/auth/start" className="rounded-lg bg-[var(--text)] px-4 py-3 text-center font-medium text-[var(--background)] hover:opacity-90">
        Sign in with Google
      </a>
    </main>
  );
}

export const metadata = { title: "Privacy · Mail" };

/** Public: Google's consent screen links here (docs/SETUP.md). Keep it true to SPEC.md's security model. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl p-6 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="mt-1 text-[var(--muted)]">Mail (mail.whitebirch.io) · last updated November 2, 2026</p>

      <p className="mt-6">
        Mail is a private web client for one person&apos;s Gmail account. Only its owner can sign in; anyone else is refused before Mail touches any data.
      </p>

      <h2 className="mt-6 text-base font-semibold">What Mail accesses</h2>
      <p className="mt-2">
        With your consent, Mail uses Google&apos;s Gmail API (scope <code>gmail.modify</code>) to show your mail, change labels (archive, read/unread, star, spam), move conversations to and from Trash, and send the
        messages you write. It reads your email address to confirm who signed in, and your Gmail send-as display name so replies carry it.
      </p>

      <h2 className="mt-6 text-base font-semibold">What Mail stores</h2>
      <p className="mt-2">
        Nothing, beyond your sign-in. Mail has no database and keeps no copy of your mail: every page is fetched from Gmail when you open it. Your Google sign-in token is kept only in an encrypted cookie in your own
        browser. Server logs record which page was requested, whether it worked and how long it took; they never record message content, addresses, search terms or tokens.
      </p>

      <h2 className="mt-6 text-base font-semibold">Sharing</h2>
      <p className="mt-2">Mail shares your data with no one, uses it for nothing but showing and managing your own mail, and never uses it for advertising or to train AI models.</p>
      <p className="mt-2">
        Mail&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="text-[var(--accent)] underline" href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2 className="mt-6 text-base font-semibold">Stopping</h2>
      <p className="mt-2">
        Signing out of Mail revokes its access to your Google account. You can also revoke it at any time at{" "}
        <a className="text-[var(--accent)] underline" href="https://myaccount.google.com/connections">
          myaccount.google.com/connections
        </a>
        .
      </p>

      <p className="mt-8">
        <a href="/login" className="text-[var(--accent)] underline">
          Sign in
        </a>
      </p>
    </main>
  );
}

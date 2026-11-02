# Mail

A small, single-user web client for one Gmail account, served at `mail.whitebirch.io`. The browser talks only to Mail, and Mail talks to the Gmail API. No mail is stored anywhere but Gmail.

It covers read, search, triage (archive, read/unread, star, trash, spam, with Undo) and plain-text reply, reply-all, forward and compose. Keyboard shortcuts follow Gmail's (`?` lists them).

- [SPEC.md](SPEC.md): what it is and isn't, plus the security model.
- [docs/SETUP.md](docs/SETUP.md): one-time Google Cloud, GitHub, AWS and DNS setup.
- [CLAUDE.md](CLAUDE.md): commands, architecture and invariants.

Built with Next.js on an AWS Lambda Web Function behind CloudFront, defined in CDK.

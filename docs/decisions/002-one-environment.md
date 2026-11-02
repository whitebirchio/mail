# ADR-002: One deployed environment

**Status:** Accepted (Scott, 2026-11-02)

## Context
Trader runs staging and production because Alpaca's paper account gives staging a safe twin of live money. Gmail has no sandbox mailbox, so a staging Mail would act on the same real inbox as production.

## Decision
There's one deployed environment: `production`, at mail.whitebirch.io, deployed from `main`.
- Feature branches run the CI gate (scan, typecheck, test, build, synth) but deploy nothing.
- The test environment is local `next dev`, which runs the real OAuth flow (redirect URI `http://localhost:3000/auth/callback`) against the real mailbox.

## Consequences
- **Merging to `main` ships.** Each change is checked locally against the real inbox before it merges.
- **Rollback** means reverting and pushing (CI redeploys), or pointing the Web Function endpoint's `revisionWeights` back at the previous revision.
- **Adding a staging environment is an Ask-first change** (SPEC.md boundaries).

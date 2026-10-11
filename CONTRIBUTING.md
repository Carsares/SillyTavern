# Contributing to Conversation v1

Develop only on the current `master` workspace as required by `AGENTS.md`. Do not create branches or worktrees. Commits and remote writes require the relevant user authorization.

## Development

Use Node.js 22.19 or newer and install with `npm ci`. Start with `npm start`; the browser entry is `/modern/conversation/`.

Application code lives in `src/conversation`, `public/shared/conversation`, and `public/modern/conversation`. Tests live in `tests/conversation`. The browser uses native modules and does not require a bundler.

Use the current contracts in `docs/conversation/CONTRACTS.md`. This is a new application: do not add old configuration aliases, legacy data readers, migration bridges, or alternate legacy startup paths. Model-provider protocol adapters and the three executor integrations are product functionality.

## Verification

Run focused offline unit tests during implementation. Once code changes are complete, run local integration checks with deterministic provider peers. Use the scripts in `package.json`; tests must not read private user data or model credentials. Do not run paid model calls, quality matrices or budget-limit experiments as ordinary validation.

Record real exit codes and distinguish static inspection, mock-provider checks and real connection evidence. Keep existing user conversations, local credentials and backups out of commits. Preserve upstream license and required third-party notices.

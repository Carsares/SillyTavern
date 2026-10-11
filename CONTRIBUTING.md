# Contributing to SillyTavern Modern Workspace

This repository maintains a Modern Workspace fork of SillyTavern. The root `README.md`, this guide, and `AGENTS.md` describe this repository; upstream SillyTavern contribution rules do not apply here.

## Repository model

`AGENTS.md` is the authoritative repository-operation policy. In summary:

- develop and target pull requests on `master` only;
- use the current working tree without creating or switching worktrees;
- treat the `upstream` remote as reference material, not a development branch source.

Any exception requires explicit maintainer approval before the repository layout changes.

## Set up the repository

Requirements:

- Git
- Node.js 20 or newer
- npm

Follow the installation and update commands in `README.md`; it is the single source for current PowerShell and POSIX commands.

Confirm that the working copy is on the expected branch before editing:

```text
git branch --show-current
git status --short --branch
```

The branch must be `master`. Existing unrelated working-tree changes belong to their author and must not be discarded or overwritten.

## Contribution workflow

1. Synchronize the current branch using the safe update procedure in `README.md`.
2. Make one focused change in the current working tree.
3. Add or update tests that cover changed behavior.
4. Run the checks appropriate to the affected area.
5. Review `git diff` and make sure no credentials, generated data, or unrelated files are included.
6. Commit and push the fork's `master` branch.
7. Open a pull request targeting this repository's `master` branch.

If Git reports conflicts or branch divergence, stop and resolve the synchronization deliberately. Do not reset or discard unrelated local changes.

## Validation

Run the current commands in the `README.md` validation section.

Modern Workspace changes should run the nearest `tests/modern-*.e2e.js` coverage. Changes to shared state, routing, API calls, chat generation, or backend contracts should also run `tests/modern-real-backend-integration.e2e.js` or the complete Modern E2E set.

Tests that contact public providers, external Git repositories, download URLs, or real model APIs belong in `tests/modern-external-dependencies.e2e.js`. They stay skipped by default and must require `MODERN_EXTERNAL_E2E=1`.

## Change quality

- Keep user-visible workflows inside the Modern Workspace unless the internal legacy bridge is required.
- Follow the ownership and backend boundaries in `MODERN_UI_ARCHITECTURE.md`.
- Update documentation in the same change when behavior, configuration, commands, or supported providers change.
- Never commit API keys, cookies, tokens, user data, backend logs, browser profiles, or generated test artifacts.

## Pull requests

Describe:

- the user-visible or technical problem;
- the implemented behavior;
- the affected routes, APIs, or data;
- the checks that were run;
- any remaining external dependency or manual verification.

Large changes are acceptable when they are cohesive, but unrelated work should be split into separate pull requests.

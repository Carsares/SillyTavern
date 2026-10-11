# New-application cleanup — 2026-10-11

The cleanup retains the Conversation v1 product capabilities. It removes old
application implementation and redundant input forms, not provider protocols or
user data. All changes are on the original master workspace.

## Removed

- 1,334 obsolete tracked files: old browser, endpoints, middleware, plugins,
  electron shell, default content, legacy tests, webpack build helpers, old
  configuration/recovery entrypoints and upstream automation/publishing scripts.
- Redundant provider aliases and wrapped connection inputs. Provider codecs remain
  accessible under their canonical names.
- Alternate auxiliary-connection selectors, nested model context, command ID
  aliases, backup-envelope aliases, and implicit first-connection selection.
- 88 unused direct runtime dependencies and 30 unused direct development
  dependencies. Runtime dependencies: 100 → 12; development dependencies: 32 → 2.
  Installed/locked dependency graph: 972 → 510 packages.

The three NovelAI tokenizer assets were relocated to
`src/conversation/providers/text/assets`, not deleted. Production packaging uses
an explicit file allowlist. Startup scripts no longer perform implicit installs
or Git updates. Docker copies only the new application trees.

## Preserved capabilities

- Native PI, Claude Agent SDK and Codex SDK; SDK protocol adaptation, explicit
  native/structured history modes, isolation, cancellation and proxy support.
- Send, regenerate, continue, impersonate, auxiliary generation, groups, drafts,
  candidates, editing/hiding, stream reconnection and transactional history.
- Character/persona/preset/worldbook/group/connection resources; macros, regex,
  text templates, worldbook timing, reasoning controls and supported media.
- Manual and automatic memory, protected blocks, summaries, bounded compaction,
  folds/expansion, source invalidation, keyword and vector retrieval.
- Six domain tools, image generation/recovery/cancellation/reuse, attachments,
  version checks, backup/restore, export, indexing, cleanup and usage accounting.

The SDK structured-history option is an explicit current UI choice; it is not an
automatic fallback. The internal `native` executor identifier remains in actual
use alongside the PI-facing name. Necessary wire-protocol differences remain.

Existing local chats, credentials, backups and prior test evidence were left
untouched. Normal application startup does not import them. Unsupported storage
layouts fail explicitly; there is no schema migration or conversion path.

## Verification

- Entry unit tests: 7 passed, exit 0.
- Offline functional unit tests: 649 passed, exit 0. Long-history evaluation cases
  were excluded with `--test-skip-pattern='full evaluation|full dataset'`.
- New-source lint: passed, exit 0; three SQL quote-style errors were fixed first.
- Local integration first run: 57 passed, 1 failed, exit 1. The failed test still
  sent the removed `{backup}` envelope. The UI already sends `{data}`. After the
  test used that canonical request, all 16 HTTP integration tests passed, exit 0.
  The unchanged 42 other integration scenarios had passed in the first run.
- Final PI and adapter-focused rerun: 63 passed, exit 0; counts overlap the unit
  suite and must not be added to it.
- All 12 runtime dependencies resolve; manifest and lock dependency sets match.
- Static source import audit found no missing relative imports. No tracked source
  remains outside the new application source tree.
- `npm pack --dry-run --ignore-scripts --json` found no unexpected files and
  included all three required tokenizer assets. No package was published.

Integration uses local deterministic provider peers, including the installed SDKs.
No user credentials were read, no paid requests were made, and no long-conversation
quality or budget-limit experiment ran in this cleanup. Browser visual validation
and Docker builds were not repeated. SDK isolation remains macOS-only; current
real-provider evidence is the previously completed three short replies.

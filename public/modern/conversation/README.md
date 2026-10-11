# Modern conversation client

Standalone development entry: `/modern/conversation/index.html`. Native ES modules,
no build step. The primary integrator owns the eventual default entry switch.
Only this directory and `tests/conversation/modules/client/` are owned by this
client task. No legacy Modern entry, global configuration, Git branch/worktree or
commit was changed by this task.

## Source contracts

- `docs/conversation/CONTRACTS.md` and shared `schemas/index.js` are canonical.
- The implementation plan is `test-results/ui-self-check/AGENT-PLAN.md` (not a root
  file; it is excluded from ordinary repository file searches).
- Resource editors use the actual defaults in shared `assembly/defaults.js` and
  `world-info/index.js`, documented by shared `assembly/README.md`.
- Additional HTTP routes below were confirmed by the integrator and statically
  checked in `src/conversation/api/index.js`. This is not an integration test.

## Files and ownership

- `index.html`, `app.js`, `style.css`: independent entry, state/controller and layout.
- `core/client.js`: JSON commands, session authentication, SSE parser/reconnect.
- `core/state.js`: snapshots, turn requests, optimistic version checks, event reducer.
- `core/dom.js`: safe DOM construction, forms, JSON display and downloads.
- `chat/view.js`: messages, drafts, turns, candidates, edits, tool/group event cards.
- `resources/model.js`, `resources/view.js`: six resource kinds and compiler defaults.
- `settings/automatic.js`, `settings/view.js`: resource selection, tools/limits, capabilities and automatic groups.
- `memory/view.js`: memory editing/locking/confirmation, folds, compression and jobs.
- `diagnostics/context.js`, `diagnostics/view.js`: five context layers, traces and usage.
- `media/model.js`, `media/view.js`: attachment references, capability gates and previews.
- `maintenance/view.js`: status, export/backup, restore, reindex and cleanup preview.
- Tests: `automatic.test.mjs`, `client.test.mjs`, `state.test.mjs`, `resources-media.test.mjs` in the owned test directory.

## HTTP requests

All business paths are relative to `/api/conversation/v1`. All non-GET JSON bodies
include `schemaVersion: 1`. Cookies use `credentials: same-origin`; the only
non-versioned request is the existing authentication infrastructure GET
`/csrf-token`, whose token is sent as `X-CSRF-Token`. It is not a legacy chat API.
HTTP error `{error:{code,message,details}}` is displayed; a 409 preserves editing
input and requires a fresh read/review. Writes are never automatically retried.
JSON requests have a 30-second client timeout; an uncertain turn acceptance keeps
its original request ID and body for explicit idempotent retry.

| Operation | Request / response consumed |
| --- | --- |
| List/create conversations | GET/POST `/conversations`; create `{title,settings}` -> Conversation or Snapshot |
| Read/delete conversation | GET/DELETE `/conversations/:id`; DELETE `{expectedContentRevision}` |
| List/create resources | GET `/resources?kind=...`, POST `/resources` `{kind,name,data}` |
| Read/update/delete resource | GET/PATCH/DELETE `/resources/:id`; PATCH `{expectedRevision,name,data}`, DELETE `{expectedRevision}` |
| Start turn | POST `/conversations/:id/turns` `{clientRequestId,type,expectedContentRevision,content?,targetMessageId?,media?,members?}` -> `{turnId,...}` |
| Recover/stop turn | GET `/turns/:id`, POST `/turns/:id/stop` `{}` |
| Versioned command | POST `/conversations/:id/commands`, shapes below |
| Candidate history | GET `/conversations/:id/messages/:messageId/candidates` -> Message versions with `candidateId,candidateRevision,content,selected` |
| Estimate | POST `/conversations/:id/estimate` `{draft,media,type}` -> compiler result |
| Compress | POST `/conversations/:id/compact` `{expectedContentRevision,expectedMemoryRevision}` |
| Automatic state | GET `/conversations/:id/automatic` -> `{enabled}` |
| Automatic group | POST `/conversations/:id/automatic` `{enabled:true,intervalMs,content,expectedContentRevision}` or `{enabled:false}`; disable does not require a content revision |
| Background jobs | GET `/conversations/:id/jobs` |
| Capabilities | GET `/capabilities?connectionId=...` |
| Traces | GET `/conversations/:id/traces`, GET `/traces/:id` |
| Events | GET `/conversations/:id/events?after=seq`, SSE `id:seq`, `data:Event` |
| Attachment upload | POST `/attachments` `{name,mime,base64}` -> `{id,name,mime,size,...}` |
| Attachment file | GET `/attachments/:id`; only server-generated IDs build preview/download URLs |
| Storage status/export | GET `/maintenance/status`, GET `/maintenance/export` |
| Backup/restore | POST `/maintenance/backup` `{}`, POST `/maintenance/restore` `{data:backup}` |
| Index rebuild | POST `/maintenance/reindex` `{conversationId}` |
| Cleanup preview/execute | POST `/maintenance/cleanup-preview` `{}` -> `{token,entries,bytes,expiresInMs}`; POST `/maintenance/cleanup` `{token}` |

List responses may be arrays or named envelopes (`resources`, `conversations`,
`candidates`, `traces`, `jobs`). Missing lists are errors, not an empty success.
Cleanup tokens stay in memory, are hidden from the generic JSON display, and are
submitted only after the user types the explicit confirmation phrase. Downloads
preserve the backup graph exactly; only a server response explicitly declaring
`credentialsIncluded:false` is downloaded. The UI does not redact or otherwise
rewrite backup contents because that could break canonical request hashes.
Restore files are bounded to 19 MiB to stay below the router's 20 MB JSON limit.

### Commands

All commands have `type` and `expectedContentRevision` from the displayed snapshot.
Existing memory commands additionally carry `expectedBlockRevision`; `memory.create`
uses `expectedMemoryRevision` from the snapshot captured when the creation form loaded.

- `conversation.configure`: `{settings}` containing resource IDs, `worldbookIds`,
  `tools`, `toolLimits`, top-level `turnTimeoutMs`, and advanced settings from the editor.
- `message.edit`: `{messageId,content}`; saves against the snapshot captured when
  editing began. Failed/conflicting edits retain their input.
- `message.delete`: `{messageId}`.
- `candidate.select`: `{messageId,candidateId,candidateRevision}`.
- `memory.create`: `{kind,content,locked,expectedMemoryRevision}`; failed or
  conflicting creation retains the form content.
- `memory.edit`: `{blockId,expectedBlockRevision,content}`.
- `memory.lock`: `{blockId,expectedBlockRevision,locked}`.
- `memory.confirm`: `{blockId,expectedBlockRevision}`.
- `fold.expand`: `{foldId,blockId,expectedBlockRevision}`.

### Resource data and capabilities

Character/persona fields are `description,personality,scenario`. Presets use
`mode,system,blocks,regex,textTemplate` (not `systemPrompt`). Worldbooks use
`scanDepth,maxRecursion,entries` and canonical entry defaults. Groups use ordered
`members` of character IDs and `mode: sequential|natural|round-robin`; a group turn
may also explicitly choose `members`. Connection fields include
`provider,executor,type,baseUrl,model,contextWindow,inputLimit,outputLimit,
maxOutputTokens,workingBudget`, with advanced `reasoning,parameters,auxiliary`.
Model limits have no guessed default values.

Executor choices: `pi` (native), `claude` (Claude Agent SDK), `codex` (Codex SDK).
New connections default to `historyMode: native-transcript`: the local gateway
expands history into native role messages at actual egress. Existing explicit modes
are preserved. All executors are selectable; server capabilities decide whether
the configured combination is supported. Input-mode descriptions come from
`cap.historyMode`; `structured-transcript` is explicitly distinguished from native
role input only when reported by the server. The UI does not require SDKs to use
structured transcripts or hardcode a disabled placeholder. The server is still responsible for actual
adapter availability and correctness.

Connection API keys and headers only exist in explicit write-only controls. They
are cleared after a write attempt and never filled from a response. Blank API keys
preserve the existing key according to the resource service. Current service code
does not preserve omitted private headers, so the UI explicitly asks users to
re-enter those headers on connection edits. Advanced JSON never accepts secret
fields. No credential is stored in browser storage.

## Streaming and recovery

The controller queries the current Snapshot and its `activeTurnId`, then GETs the
persisted Turn; it also retains the latest turn ID and unresolved accepted-request
body in sessionStorage. Reloading never starts external work. Replaying from zero
is safe: sequence numbers deduplicate events, offsets deduplicate content already
present in a recovered Turn, and gaps trigger authoritative refresh. The cursor is
advanced only after consumer acceptance. Disconnects use bounded exponential
backoff; `cursor-expired` reloads state before replay. Closing/switching a
conversation aborts the old stream and ignores stale refresh responses.

`text.delta` and `reasoning.delta` update separate fields. Other events refresh
snapshots/turns. Tool/group/usage and background-failure events are displayed from
committed event data, capped at 200 recent non-delta events in memory; full traces
and jobs are fetched separately. Terminal/partial content and impersonation drafts
are shown without inventing persisted messages. Estimates are labeled separately
from provider usage; missing usage is not filled with zero.

## Remaining integration boundaries

1. Browser, live HTTP, backend persistence, SDK/provider and end-to-end tests were
   intentionally not run. Final root composition and routing belong to the primary.
2. Typed media request shape is `{type,attachmentId,mimeType,name,size}`. The UI
   uploads and previews files and submits only attachment references. The runtime
   must resolve references and the capabilities endpoint must declare media support
   before such media may be sent; the client refuses unsupported media. Upload
   success is never presented as successful model ingestion.
3. Media estimates submit `{draft,media}` with the same typed references as send.
   Backend compiler/runtime integration must account for these parts and load image
   bytes from the attachment service; the browser never reads filesystem paths.
   HTTP errors remain visible; there is no text-only fallback for a failed media estimate.
4. Private headers preservation and compression revision checks are backend
   responsibilities. Automatic state is read from the server on settings load,
   after toggle writes and on `automatic.changed`. Restart defaults to disabled;
   the UI never automatically enables scheduling or resends paid work. Request versions are sent;
   their enforcement/persistence has not been verified by this client task.
5. Advanced auxiliary-model, reasoning and memory-frequency settings can be saved
   in JSON, but UI save success does not certify that a backend consumes every
   advanced setting. Only capability responses and traces are evidence of effect.

## Focused checks

`node --test tests/conversation/modules/client/*.test.mjs`: 28 tests passed at
client handoff. Includes request versions, structured failures, fragmented UTF-8
SSE, reconnect/deduplication/cursor reset, recovered content offsets, terminal
safety, redaction, canonical resource defaults, SDK mode labels and media gates.

`./node_modules/.bin/eslint public/modern/conversation/**/*.js public/modern/conversation/app.js`:
passed after correcting the initially reported catch-parameter reassignment.
No browser/integration/provider tests or real user-data writes were performed.

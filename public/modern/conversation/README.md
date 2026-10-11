# Modern conversation client

The server root redirects to `/modern/conversation/`. This client uses native ES
modules without a build step and shares protocol and compiler modules under
`public/shared/conversation/`.

## Source contracts

- `docs/conversation/CONTRACTS.md` and shared `schemas/index.js` are canonical.
- Resource editors use the actual defaults in shared `assembly/defaults.js` and
  `world-info/index.js`, documented by shared `assembly/README.md`.
- HTTP route implementations are in `src/conversation/api/index.js`.

## Modules

- `index.html`, `app.js`, `style.css`: client entry, state/controller and layout.
- `core/client.js`: JSON commands, session authentication, SSE parser/reconnect.
- `core/state.js`: snapshots, turn requests, optimistic version checks, event reducer.
- `core/operations.js`: authoritative snapshot acceptance and confirmed-write readback handling.
- `core/dom.js`: safe DOM construction, forms, JSON display and downloads.
- `chat/view.js`: messages, drafts, turns, candidates, edits, tool/group event cards.
- `resources/model.js`, `resources/view.js`, `resources/guidance.js`: six resource kinds and compiler defaults.
- `settings/automatic.js`, `settings/view.js`: resource selection, tools/limits, capabilities and automatic groups.
- `memory/model.js`, `memory/view.js`, `memory/sources.js`: memory editing/locking/confirmation, folds, compression and jobs.
- `diagnostics/context.js`, `diagnostics/view.js`, `diagnostics/usage.js`, `diagnostics/tools.js`: context layers, traces, server usage tables and stored tool result expansion.
- `media/model.js`, `media/view.js`: attachment references, capability gates and previews.
- `maintenance/model.js`, `maintenance/view.js`: status, export/backup, restore, reindex and cleanup preview.
- Tests: `automatic.test.mjs`, `client.test.mjs`, `state.test.mjs`, `resources-media.test.mjs`, `audit.test.mjs`, `views.test.mjs` in the client test directory.

## HTTP requests

All business paths are relative to `/api/conversation/v1`. All non-GET JSON bodies
include `schemaVersion: 1`. Cookies use `credentials: same-origin`; GET `/csrf-token` supplies the token sent as `X-CSRF-Token` on writes.
HTTP error `{error:{code,message,details}}` is displayed; a 409 preserves editing
input and requires a fresh read/review. Writes are never automatically retried.
JSON requests have a 30-second client timeout; an uncertain turn acceptance keeps
its original request ID and body for explicit idempotent retry.

| Operation | Request / response consumed |
| --- | --- |
| List/create conversations | GET/POST `/conversations`; create `{title,settings}` -> Conversation |
| Read/delete conversation | GET/DELETE `/conversations/:id`; DELETE `{expectedContentRevision}` |
| List/create resources | GET `/resources?kind=...`, POST `/resources` `{kind,name,data}` |
| Read/update/delete resource | GET/PATCH/DELETE `/resources/:id`; PATCH `{expectedRevision,name,data}`, DELETE `{expectedRevision}` |
| Start turn | POST `/conversations/:id/turns` `{clientRequestId,type,expectedContentRevision,content?,targetMessageId?,media?,members?}` -> `{turnId,...}` |
| Recover/stop turn | GET `/turns/:id`, POST `/turns/:id/stop` `{}` |
| Versioned command | POST `/conversations/:id/commands`, shapes below |
| Source message history | GET `/conversations/:id/messages/:messageId/history` -> `{conversationId,messageId,deletedAt,versions:[...]}`; deleted histories remain readable |
| Candidate history | GET `/conversations/:id/messages/:messageId/candidates` -> Message versions with `candidateId,candidateRevision,content,selected` |
| Estimate | POST `/conversations/:id/estimate` `{draft,media,type}` -> compiler result |
| Compress | POST `/conversations/:id/compact` `{expectedContentRevision,expectedMemoryRevision}` |
| Automatic state | GET `/conversations/:id/automatic` -> `{enabled}` |
| Automatic group | POST `/conversations/:id/automatic` `{enabled:true,intervalMs,content,expectedContentRevision}` or `{enabled:false}`; disable does not require a content revision |
| Background jobs | GET `/conversations/:id/jobs` |
| Capabilities | GET `/capabilities?connectionId=...` |
| Usage | GET `/conversations/:id/usage` -> `{totals,categories:{generation,memory,embedding,image},turns}` |
| Complete tool result | GET `/tools/:id` -> persisted tool record; IDs come from nested `resultRef`, including JSON text content blocks |
| Traces | GET `/conversations/:id/traces`, GET `/traces/:id` |
| Events | GET `/conversations/:id/events?after=seq`, SSE `id:seq`, `data:Event` |
| Attachment upload | POST `/attachments` `{name,mime,base64}` -> `{id,name,mime,size,...}` |
| Attachment file | GET `/attachments/:id`; only server-generated IDs build preview/download URLs |
| Storage status/export | GET `/maintenance/status`, GET `/maintenance/export` |
| Backup/restore | POST `/maintenance/backup` `{}`, POST `/maintenance/restore` `{data:backup}` |
| Index rebuild | POST `/maintenance/reindex` `{conversationId}` |
| Cleanup preview/execute | POST `/maintenance/cleanup-preview` `{}` -> `{token,entries,bytes,expiresInMs}`; POST `/maintenance/cleanup` `{token}` |

List responses are arrays. Named envelopes are rejected. Candidate records use
`candidateId` and `candidateRevision`; snapshot settings are read from
`snapshot.settings`. Only `text.delta` and `reasoning.delta` append stream text.
Missing lists are errors, not an empty success.
Cleanup tokens stay in memory, are hidden from the generic JSON display, and are
submitted only after the user types the explicit confirmation phrase. Downloads
preserve the backup graph exactly; only a server response explicitly declaring
`credentialsIncluded:false` is downloaded. The UI does not redact or otherwise
rewrite backup contents because that could break canonical request hashes.
Backup/restore JSON uses the shared 256 MiB limit, including the restore envelope and UTF-8 bytes. Ordinary requests retain the 20 MiB limit. Over-limit export errors remain visible without downloading a partial backup. The maintenance panel explains the offline alternative: stop the server cleanly, preserve the entire conversation-v1 directory including SQLite companion files and attachments, and restore into an unused directory of the same schema version. Never copy only a live database file.

### Commands

All commands have `type` and `expectedContentRevision` from the displayed snapshot.
Existing memory commands additionally carry `expectedBlockRevision`; `memory.create`
uses `expectedMemoryRevision` from the latest displayed snapshot while preserving the unsaved creation draft.

- `conversation.configure`: `{settings}` containing resource IDs, `worldbookIds`,
  `tools`, `toolLimits`, top-level `turnTimeoutMs`, and advanced settings from the editor.
- `message.edit`: `{messageId,content,media}`; saves against the snapshot captured when
  editing began. Attachments can be uploaded, removed or replaced; an empty media array removes all media. Failed/conflicting edits retain text and staged media without mutating the displayed snapshot.
- `message.delete`: `{messageId}`.
- `candidate.select`: `{messageId,candidateId,candidateRevision}`.
- `memory.create`: `{kind,content,locked,expectedMemoryRevision}`; kind is one of `character,relationship,world-state,timeline,user-fact`, content is 1–8000 characters; failed or
  conflicting creation retains the form content.
- `memory.edit`: `{blockId,expectedBlockRevision,content}`.
- `memory.lock`: `{blockId,expectedBlockRevision,locked}`.
- `memory.confirm`: `{blockId,expectedBlockRevision}`.
- `fold.expand`: `{foldId,blockId,expectedBlockRevision}`.

### Resource data and capabilities

Character/persona fields are `description,personality,scenario`. Presets use
`mode,system,blocks,regex,textTemplate`. Worldbooks use
`scanDepth,maxRecursion,entries` and canonical entry defaults. Groups use ordered
`members` of character IDs and `mode: sequential|natural|round-robin`; a group turn
may also explicitly choose `members`. Connection fields include
`provider,executor,type,baseUrl,model,contextWindow,inputLimit,outputLimit,
maxOutputTokens,workingBudget`, with advanced `reasoning,reasoningBudget,parameters,capabilities,proxy`.
Model limits have no guessed default values.

Executor choices: `pi` (native), `claude` (Claude Agent SDK), `codex` (Codex SDK).
New connections default to `historyMode: native-transcript`: the local gateway
expands history into native role messages at actual egress. Explicit supported modes are preserved. All executors are selectable; server capabilities decide whether
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

## Static audit and usage semantics

Snapshots and command results are direct Snapshot objects: `snapshot.id` identifies
that snapshot, while `snapshot.conversation.id` identifies the conversation.
Confirmed commands apply their returned snapshot before follow-up reads; a failed
read displays a warning without presenting the write as failed or inviting a
second memory creation. Late turn acceptance cannot overwrite already received
streamed/terminal state. Group member IDs prevent deltas joining another member's
content. Candidate controls use candidate identity/revision and preserve their
panel across unrelated renders; partial and selected status are explicit.

Usage tables show overall totals, all four categories and individual turns. Each
server aggregate contains `calls,inputTokens,outputTokens,cacheReadTokens,
cacheWriteTokens,reasoningTokens,totalTokens,costUsd,complete`. Null or absent
values display unknown; known zero remains zero. Cache/reasoning subcounts are
not added into totalTokens. Call counts come from the server and include issued
partial/failed requests, excluding prepare-only work. The client does not invent
costs. Usage failures and trace failures are displayed independently. Tool result
references can explicitly fetch the persisted complete record; rendering uses
text nodes and redacts credentials, with visible loading/failure and retry.

Cleanup preview has a separate persistent display so unrelated maintenance reads
cannot hide the preview whose token will be executed. Attachment display can use
snapshot metadata without requiring MIME/name duplication on each media ref.
CSRF must return a nonempty token before any business write is attempted.

Source links on memories, summaries and folds can focus the current message or
read its preserved history, including candidate versions. History responses must
match both conversationId and messageId; only server deletedAt confirms deletion.
Exact source revision/candidate matches are labeled; changed or absent versions
are explicit and never silently substituted. Parent summaries expose their own
sources with cycle protection. Reads show loading/errors and remain retryable.

Persisted media on messages, tool events and complete tool results is rendered
through the attachment endpoint, using snapshot MIME metadata when necessary.
Explicit `{url,external:true}` media remains a link marked not persisted; it
never becomes an automatic remote image request. Unsafe URL schemes are not linked.

## Connection selection and media

Conversation settings select `connectionId`, `auxiliaryConnectionId`,
`embeddingConnectionId` and `imageConnectionId`. Memory/summary generation uses
`auxiliaryConnectionId` or the main connection if absent. Embedding and image
connections are selected separately. Connection-level `auxiliary` objects are
not accepted or migrated. The UI saves `settings.tools` as an array of tool names;
it also reads the name/boolean object currently accepted by the tool registry.
The supported `native` executor value is displayed and saved as `pi`, selecting
the same executor. Removing either input form requires coordinating its backend
contract first.

Typed attachments use `{type,attachmentId,mimeType,name,size}`. The runtime
resolves attachment bytes; the client never reads server filesystem paths.
Send and estimate use the same media references and capability checks. Upload
success does not imply model media support. The media view can use persisted
attachment metadata (`mime`, `name`) when a reference omits these details.

Connection guidance documents `type`, string `reasoning`, `reasoningBudget`,
`capabilities.reasoningEnabled/reasoningEfforts/media/mediaTokenCost/verified`.
Connections are flat objects; `reasoning` is a string and media token budgets
live only in `capabilities.mediaTokenCost`. Provider identifiers are canonical
(e.g. `openai-compatible`, `anthropic`, `google`, `vertexai`); unknown providers
are rejected by the server, not translated by the client. Examples are
explanatory and never automatically marked verified.
`memoryFrequency` is a positive-integer conversation setting.

## Additional feature contracts

- `memory/view.js`: `summary.edit {summaryId,expectedBlockRevision,content}`;
  edits retain their original block revision on conflict.
- `chat/view.js`: `message.hide {messageId,hidden}` independently controls
  `userHidden`, with reversible presentation separate from automatic folding.
- `retrieval/view.js`: GET `/conversations/:id/retrieval` and
  `retrieval.updated {status,semanticReady,count,error?}`. Events supersede pending
  reads; conversation changes discard stale responses. Unknown/error states stay visible.
- `jobs/view.js`: GET `/conversations/:id/jobs`, POST
  `/conversations/:id/jobs/:jobId/resume` and `/cancel` with schemaVersion 1.
  Only image provider jobs with persisted payload.jobId and an idle conversation
  expose enabled controls. Missing handles never permit resubmission. Completed
  payload.result.media uses `/attachments/:id`; old messages remain unchanged.
- `resources/view.js`: proxy is write-only `data.proxy:{url}`. Blank preserves;
  explicit clear sends null. The entire proxy object is redacted and input cleared.
- `diagnostics/usage.js`: costEstimated=true labels known costs as estimates;
  null costs remain unknown. Token subcounts never inflate totalTokens.
- `maintenance/view.js`: status traceCount/traceBytes/detailBytes are labeled as
  UTF-8 JSON logical bytes, not SQLite physical storage. Cleanup preview takes
  traceRetentionMs; changing retention invalidates its token. Export validates
  conversation-v1-export effective history; backup validates conversation-v1-backup
  and credentialsIncluded=false. Restore still requires a full backup.

## Focused verification

Run `node --test --test-concurrency=6 tests/conversation/modules/client/*.test.mjs
tests/conversation/modules/context/*.test.mjs` for client and compiler checks.
DOM tests use an in-memory document implementation. Manual browser helpers in the
test directory are not part of this command. Unit checks do not establish live
provider support; integration evidence belongs in the project validation record.

## Normalization evidence and retained behavior

This cleanup changes redundant input shapes, not product operations. Source paths
below are repository-relative. Protocol differences remain in provider adapters;
this browser does not translate provider identifiers or wire reasoning fields.

| Removed browser/compiler alternative | Active producer or replacement evidence |
| --- | --- |
| Named list envelopes | `src/conversation/api/index.js` returns arrays for resource/conversation/candidate/trace/job list routes. Object envelopes for message history and usage remain unchanged. |
| Conversation-or-Snapshot creation response | POST `/conversations` returns `store.createConversation`; the client reads its `id`. Reads and command results still use Snapshot. |
| Candidate `id/revision` substitutes | `store.getCandidates` returns message versions with explicit `candidateId/candidateRevision`; using message identity here would select the wrong entity. |
| `turn.delta` / `turn.reasoning*` event aliases | `store.appendDelta` emits only `text.delta` and `reasoning.delta`. Other events still trigger authoritative refresh. |
| Merging `conversation.settings` into compiler/UI settings | Store snapshot creation explicitly projects current settings to `snapshot.settings`. Composition builds auxiliary snapshots by replacing that field, so merging another settings copy could reintroduce unrelated selectors. |
| Nested `capabilities.limits` and `capabilities.enabled` | Current capability modules emit direct budget fields and `supported`. Actual composition passes these capabilities to the compiler. Compiler rejects obsolete fields instead of silently ignoring a supplied limit. |
| Inline fold text as an alternative summary | `src/conversation/memory/index.js` creates folds with `summaryRef`; compilation resolves that exact summary revision and validates its sources. Inline fold text may remain stored as metadata but cannot bypass summary validity. |
| Connection-level auxiliary selection | `composition.connectionId` reads the three conversation setting IDs; only auxiliary generation defaults to `settings.connectionId`. UI selectors save those exact IDs. |
| `externalURL`, `externalUrl`, media-ref `mime` aliases | `composition.registerMedia` produces persisted `{attachmentId,mimeType,...}` refs. UI retains explicit external `{url,external:true}` links and attachment metadata fallback `metadata.mime`. Provider URLs are downloaded/registered by the server, not displayed as arbitrary remote images. |
| `effort`, object reasoning, top-level media budget, wrapped connection input | `capabilities/core.connectionShapeError` requires a flat connection, string `reasoning`, and `capabilities.mediaTokenCost`. The resource editor checks these same fields before save; its tests compare with the actual server helper. |
| Development-entry and phase-handoff descriptions | `server.createApplication` redirects `/` to `/modern/conversation/`; documentation now describes that current entry and stable interfaces. |

Retained behavior includes chat and text templates; all six generation types;
PI/Claude/Codex choices and native/structured SDK input modes; provider-specific
reasoning modes and budgets; image/audio/video/document references and previews;
attachment metadata fallback; SDK tool results encoded as JSON text; memory,
summary editing, folds, retrieval and worldbook recursion/probability/cooldown;
macros with effect proposals, regex stages, source invalidation and full-history
budget rejection; group/manual/automatic scheduling; image-job resume/cancel;
proxy write-only input; backup/export/restore; usage, traces and unknown costs.

Effective defaults are retained: absent reasoning stays absent for server/model
handling; presets and worldbooks clone shared defaults; absent auxiliary selection
uses the primary connection; tool defaults enable recall_memory, search_lore,
roll_dice and get_time while leaving update_memory and generate_image disabled.
The backend still accepts `native` as the PI executor and name/boolean tool maps,
so the UI continues reading these while writing canonical `pi` and name arrays.
These inputs are not declared unused and must not be removed independently.

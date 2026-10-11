# Conversation v1 implementation contracts

This is the canonical implementation interface for AGENT-PLAN.md. New schema only, no legacy data or engine. All work in current master checkout. No branch/worktree. Owner of shared schema, dependency manifests, root routing and composition is the primary integrator. Node >=22.19; built-in node:sqlite is the persistence driver. Modules use ESM and node:test in tests/conversation/modules/<name>/*.test.mjs. Automated unit/integration tests use isolated generated data and local peers. The explicitly invoked live connection check may read the user-authorized existing selected connection in memory; it must not copy legacy conversations, persist credentials or run as part of CI.

## Test and commit policy

The user's latest instruction overrides intermediate integration gates: commit code by stage, run only focused unit tests during development. Defer integration, browser, real-provider and full-system tests until all implementation changes are ready. A stage commit is not evidence of integrated correctness. Record outstanding capability blockers explicitly. Do not enable an unverified SDK by pretending it implements the contract.

## Data shapes

- Resource: `{id,kind,name,revision,data}`; kinds character/persona/preset/worldbook/group/connection. Connection data: `{provider,executor,baseUrl,model,contextWindow,inputLimit?,outputLimit,maxOutputTokens,workingBudget,reasoning?,apiKey?,headers?,parameters?}`. Credentials must never be returned by public resource/snapshot/list APIs or traces. Repository exposes `getConnection(id)` only internally. Every persisted resource revision is retained for frozen snapshots.
- Conversation: `{id,title,contentRevision,memoryRevision,activeTurnId,resourceRefs:[{id,revision}],settings,createdAt}`. `settings.connectionId`, `auxiliaryConnectionId`, `embeddingConnectionId`, `imageConnectionId`, `characterId`, `personaId`, `presetId`, `worldbookIds`, `groupId` select new resources. Configuration changes use a versioned command.
- Message: `{id,conversationId,turnId,role,content,revision,candidateId,candidateRevision,status,media:[],deletedAt?}`. Role user/assistant/system/tool. Revisions and candidates immutable; default reads only current selected nondeleted messages. Candidate and revision history accessible separately.
- Snapshot: `{id,conversationId,conversation,messages,resources,memories,summaries,folds,settings}`. Immutable input to model/context modules. `sourceRef(message)` comes from shared schemas.
- Turn: `{id,conversationId,clientRequestId,type,targetMessageId?,status,attemptEpoch,snapshotId,turnIndex,pendingEffects,plannedMembers?,content,reasoning,usage,error?,request}`. Accepted request is the shared `validateTurnRequest` shape. Reply and request identifiers are server-generated except clientRequestId. The server owns worldInfo.turnIndex; successful send/group/regenerate/continue advances it once. Draft-only auxiliary/impersonate requests do not advance or commit effects.
- Event: `{schemaVersion,eventId,seq,conversationId,turnId?,type,payload,entityRevisions}`. seq increases per conversation, all business changes and corresponding events in one transaction. Delta payload `{text,offset,messageId?,candidateId?}`. No publish before commit.
- Memory/summary/fold: `{id,revision,status,sourceRefs,parentSummaryRefs?,content,kind?,origin?,locked?}`. status valid/stale/pending-confirm. sourceRefs are message version and selected candidate references; parent summaries retain transitive dependencies.

## Store port (synchronous, no external I/O inside transactions)

`createStore({directory,now?,id?})` exported from `src/conversation/store/index.js`.

- `createConversation({title?,settings?,resourceRefs?})`, `listConversations()`, `getConversation(id)` (returns Snapshot), `deleteConversation(id, expectedContentRevision)`.
- `createResource({kind,name,data})`, `listResources(kind?)`, `getResource(id,revision?)`, `getConnection(id)` (internal secrets), `updateResource(id,{expectedRevision,name?,data})`, `deleteResource(id,expectedRevision)`.
- `beginTurn(conversationId,request)` -> `{turn,snapshot,replayed}`. Dedupe on canonical original request BEFORE checking stale versions/current resources. Atomically validate versions/activity, add exactly one user message, create turn/snapshot/event. Caller preflight must also be run only for a new request: optional third argument `preflight(snapshot, request)` executes synchronously before writes, no model I/O.
- `getTurn(id)`, `appendDelta(turnId,{text?,reasoning?},attemptEpoch)`, `appendEvent(conversationId,type,payload,turnId?)`, `events(conversationId,after=0)`.
- `getTurnSnapshot(turnId)` returns current message/derived records with frozen resources/settings and temporary group effects. Committed conversation reads never expose these temporary settings. Member replies persist independently; effects commit only at successful parent completion. A retry inherits completed member effects and rejects if subsequent successful turns changed their timing base.
- `finishTurn(turnId,{status,content?,media?,reasoning?,usage?,error?,effects?,memoryProposals?},attemptEpoch)` commits terminal result, selected candidate/continuation or partial draft, event and releases active turn atomically; ignores/rejects late epoch or terminal callback. No duplicate finalization. Media must reference registered attachments, never inline bytes or filesystem paths.
- `getMessageHistory(conversationId,messageId)` returns `{conversationId,messageId,deletedAt,versions}` even for deleted messages; rejects a message from a different conversation. `getCandidates(conversationId,messageId)` exposes retained candidate versions separately.
- `requestStop(turnId)`, `recoverInterrupted()`; reopening marks unfinished turns interrupted without resending external work.
- `command(conversationId,command)` -> Snapshot. Types conversation.configure, message.edit, message.delete, candidate.select, memory.create, memory.edit, memory.lock, memory.confirm, fold.expand. Command carries `expectedContentRevision` for history/settings, `expectedMemoryRevision` for creation or `expectedBlockRevision` for an existing memory. Active turn rejects manual mutation. History changes atomically invalidate dependent data, including transitive summary/fold refs.
- `commitDerived(conversationId,{summaries?,memories?,folds?,sourceRefs?,expectedMemoryRevision?,turnId?,attemptEpoch?})`: revalidate dependencies and locks. Idle commits only, except current-turn foreground compaction; return accepted proposal or conflict, never partial updates.
- `createJob({conversationId,kind,dependencies,payload})`, `listJobs(conversationId?)`, `updateJob(id,patch)`; dependency fingerprint dedupe.
- `commitDerivedJob(jobId)` atomically validates the ready job and its proposal, writes derived data, records events and marks the job completed. Completed replay returns the saved outcome without writing again. Recomputed dependencies and their fingerprint update together.
- `recordTool({conversationId,turnId,memberRunId?,toolCallId,requestHash,name,args})` -> `{record,replayed}`; `finishTool(id,{status,result?,error?,usage?})`, `getTool(id)`. Unknown side effects not automatically replayed.
- `saveTrace({conversationId,turnId?,...trace})`, `getTrace(id)`, `listTraces(conversationId)`; `exportData()`, `restoreData(data)` (empty new store only), `close()`.

## Compiler, memory and retrieval ports

Internal consumers use `snapshot.settings` and `snapshot.conversationId` directly. Auxiliary connections are selected only by `settings.auxiliaryConnectionId`, `settings.embeddingConnectionId`, and `settings.imageConnectionId`. If auxiliaryConnectionId is absent, summaries use settings.connectionId; an explicitly missing resource fails. Embedding remains keyword-only without embeddingConnectionId, and image generation requires imageConnectionId. No primary connection.data.auxiliary memory/summary/summarization/embedding/image aliases, string/object role variants, or conversation.settings fallback are interpreted. All active-turn selections resolve frozen resource revisions.

Composition accepts connection data objects; store Resource envelopes are unwrapped at the store boundary. Tool sessions read `store.getTurnSnapshot(turnId)` unless runtime supplies the member snapshot, and use `settings.timeZone` (default UTC). Derived updates use `expectedBlockRevision`, never expectedRevision.

`compileContext(snapshot,{draft?,media?,type?,targetMessageId?,countTokens?,workingBudget?,capabilities?,variables?,seed?,tools?})` in shared assembly/index.js -> `{messages,blocks,estimatedTokens,budget,omitted,effects,sourceRefs,type}`. messages use string content or typed media parts. Composition resolves opaque attachment IDs before compilation. Model SDK conversion is in executor. Compiler must reject required content over budget, never silently drop raw history. It can raise budget-blocked with compressible source refs, consumed by context service. Count fallback explicitly conservative estimate, no false exact counts.

`computeBudget({contextWindow,inputLimit?,maxOutputTokens,workingBudget})` in policy/index.js -> `{hardInputBudget,workingBudget,safetyTokens}`.

`createMemoryService({store,generate,now?})` in memory/index.js: `prepareCompact(snapshot,options)` returns a proposal and disposable compacted snapshot without writes; `combineProposals(proposals,base)` and `previewCompact(base,proposal)` support at most two speculative foreground passes. Runtime compiles the combined preview before one `store.commitDerived` call. `compact(snapshot,{signal,budget})` is the idle-conversation manual compression operation; it rejects active conversations and turn scope arguments. The HTTP/runtime manual compact feature remains available; foreground callers use only prepare/combine/preview and a final commit. `schedule(conversationId)` and `drain({signal}?)` handle background jobs; `commitDerivedJob` commits proposal and job completion atomically. `generate(request)` is injected and returns a parsed `{chapter,rolling?,memories?}` object; composition owns provider JSON parsing. Memory does not accept serialized response strings and imports no SDK. Failed/ready/stale job states remain visible, with at most one recomputation.

`createRetrieval({store,embed?})` in retrieval/index.js: `search(conversationId,query,{limit?,snapshot?,signal?})`, `index(conversationId,{signal}?)`, `rebuild(conversationId)`. Returned entries `{content,sourceRefs,score,method}` always revalidate current source versions. Index files only in explicitly supplied new data location; use memory if none.

## Execution, tools and runtime ports

`createPiExecutor({onRequest?}={})` in executors/pi/index.js exposes `runTurn({snapshot,requestPlan,connection,tools=[],limits,signal,beforeRequest,onEvent})` -> `{content,reasoning,usage,finishReason}`. onEvent({type,text?,...payload}) callback may be async, ordering/persistence awaited. beforeRequest(actualContext) invoked for every model call. No custom model/tool loop layered over SDK. Connection secrets never stored in events. Unsupported source/type rejected preflight.

`getCapabilities(connection)` in capabilities/core/index.js reports executor/provider/model/type/media/tool support and finite budgets. Explicit unknown combination disabled.

`createToolRegistry({store,retrieval,memory,resources?,image?,now?,random?})` in tools/index.js exposes `definitions({type,enabled?})`, `execute({turnId,conversationId,memberRunId?,toolCallId,name,args,signal})`. Definition `{name,description,parameters}` JSON schema. Six tool names per plan. Limits from shared TOOL_LIMITS. SDK converts definitions into its own tool format; MCP same registry. Tools never overwrite manual memory.

`createRuntime({store,executor,compile,memory?,retrieval?,tools?,trace?,groups?,capabilities?})` in runtime/index.js: `start(conversationId,request)` -> accepted `{turnId,status,contentRevision,eventCursor,replayed}` immediately; `stop(turnId)`; `estimate(conversationId,{draft,...options})`; `close()` aborts and joins active work. No provider I/O inside acceptance transaction. Runtime owns cancel controllers/deadline, captured epochs, persistence, preflight, compaction, event mapping and terminal commit. Auxiliary and impersonate return drafts, never user messages. Deterministic per-type handling. Integration with group service via frozen member requests.

## HTTP and browser port

`createRouter({store,runtime,capabilities,maintenance?,resources?,attachments?})` in api/index.js returns Express Router. Paths relative to API_BASE: resources GET/POST; resources/:id GET/PATCH/DELETE; conversations GET/POST; conversations/:id GET/DELETE; conversations/:id/turns POST; turns/:id GET; turns/:id/stop POST; conversations/:id/commands POST; conversations/:id/estimate POST; conversations/:id/events GET; capabilities GET; traces/:id GET; conversations/:id/traces GET; maintenance endpoints. JSON error `{error:{code,message,details}}` with appropriate status. Events use SSE with id:seq and data:JSON, cursor query `after`; poll committed records, never in-memory-only publication. Schema version required on mutating bodies. The standalone server owns one workspace, validates allowed hosts/origins and CSRF, and requires password authentication for remote listeners. No user-controlled filesystem paths. GETs do not create data.

New browser code in public/modern/conversation/ with core/client.js and core/state.js. A standalone new entry is provided during development; default Modern entry switches only in final stage. It never imports old actions/chat-generation.js, hidden iframe or old chat APIs. HTML textContent for all untrusted text. Secrets write-only. Buttons/loading/errors/conflicts/reconnect/partial replies visible; do not claim unimplemented features succeeded.

## Final integration additions

- `store.subscribe(listener) -> unsubscribe` emits only committed events after
  releasing the transaction lock. Listener failures do not undo committed state.
- `store.listTools(conversationId)` and `recoverTool(recordId,result)` support
  explicit paid-tool recovery. Recovery requires a terminal original turn, idle
  conversation and unknown original result; completed identical replay is local.
- `summary.edit` uses `summaryId`, `expectedBlockRevision` and `content`.
  `message.hide` uses `messageId`, `expectedContentRevision` and boolean `hidden`.
  User hiding and fold expansion are independent.
- `runtime.retrievalStatus(id)` and `scheduleRetrieval(id)` expose and refresh
  semantic readiness; `GET conversations/:id/retrieval` and `retrieval.updated`
  carry `{status,semanticReady,count,error?}`. Errors remain sanitized.
- `providerJobs.resume(conversationId,jobId)` and `cancel` are exposed as
  `POST conversations/:id/jobs/:jobId/resume` and `/cancel`. A saved provider
  handle is mandatory; these operations never submit a new job. Completed
  `payload.result.media` contains registered attachment references.
- `maintenance.export()` is current-history export; `maintenance.backup(options)`
  is the full restorable format. `status()` includes `traceCount/traceBytes/detailBytes`.
  Cleanup preserves usage while dropping eligible trace details and unreferenced files.
- Connection `proxy:{url}` is validated and write-only. Omitted updates preserve
  it; null clears it. The whole proxy is excluded from public snapshots and backups.
  `createConnectionFetch` owns routing and connection cleanup.
- Usage `costUsd/costSource/costEstimated` distinguishes reported amounts from
  explicit estimates; unknown inputs remain unknown in aggregate.

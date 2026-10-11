# Conversation v1 implementation contracts

This is the canonical implementation interface for AGENT-PLAN.md. New schema only, no legacy data or engine. All work in current master checkout. No branch/worktree. Owner of shared schema, dependency manifests, root routing and composition is the primary integrator. Node >=22.19; built-in node:sqlite is the persistence driver. Modules use ESM and node:test in tests/conversation/modules/<name>/*.test.mjs. No tests may access real data or paid endpoints.

## Test and commit policy

The user's latest instruction overrides intermediate integration gates: commit code by stage, run only focused unit tests during development. Defer integration, browser, real-provider and full-system tests until all implementation changes are ready. A stage commit is not evidence of integrated correctness. Record outstanding capability blockers explicitly. Do not enable an unverified SDK by pretending it implements the contract.

## Data shapes

- Resource: `{id,kind,name,revision,data}`; kinds character/persona/preset/worldbook/group/connection. Connection data: `{provider,executor,baseUrl,model,contextWindow,inputLimit?,outputLimit,maxOutputTokens,workingBudget,reasoning?,apiKey?,headers?,parameters?,auxiliary?}`. Credentials must never be returned by public resource/snapshot/list APIs or traces. Repository exposes `getConnection(id)` only internally. Every persisted resource revision is retained for frozen snapshots.
- Conversation: `{id,title,contentRevision,memoryRevision,activeTurnId,resourceRefs:[{id,revision}],settings,createdAt}`. `settings.connectionId`, `characterId`, `personaId`, `presetId`, `worldbookIds`, `groupId` select new resources. Configuration changes use a versioned command.
- Message: `{id,conversationId,turnId,role,content,revision,candidateId,candidateRevision,status,media:[],deletedAt?}`. Role user/assistant/system/tool. Revisions and candidates immutable; default reads only current selected nondeleted messages. Candidate and revision history accessible separately.
- Snapshot: `{id,conversationId,conversation,messages,resources,memories,summaries,folds,settings}`. Immutable input to model/context modules. `sourceRef(message)` comes from shared schemas.
- Turn: `{id,conversationId,clientRequestId,type,targetMessageId?,status,attemptEpoch,snapshotId,content,reasoning,usage,error?,request}`. Accepted request is the shared `validateTurnRequest` shape. Reply and request identifiers are server-generated except clientRequestId.
- Event: `{schemaVersion,eventId,seq,conversationId,turnId?,type,payload,entityRevisions}`. seq increases per conversation, all business changes and corresponding events in one transaction. Delta payload `{text,offset,messageId?,candidateId?}`. No publish before commit.
- Memory/summary/fold: `{id,revision,status,sourceRefs,parentSummaryRefs?,content,kind?,origin?,locked?}`. status valid/stale/pending-confirm. sourceRefs are message version and selected candidate references; parent summaries retain transitive dependencies.

## Store port (synchronous, no external I/O inside transactions)

`createStore({directory,now?,id?})` exported from `src/conversation/store/index.js`.

- `createConversation({title?,settings?,resourceRefs?})`, `listConversations()`, `getConversation(id)` (returns Snapshot), `deleteConversation(id, expectedContentRevision)`.
- `createResource({kind,name,data})`, `listResources(kind?)`, `getResource(id,revision?)`, `getConnection(id)` (internal secrets), `updateResource(id,{expectedRevision,name?,data})`, `deleteResource(id,expectedRevision)`.
- `beginTurn(conversationId,request)` -> `{turn,snapshot,replayed}`. Dedupe on canonical original request BEFORE checking stale versions/current resources. Atomically validate versions/activity, add exactly one user message, create turn/snapshot/event. Caller preflight must also be run only for a new request: optional third argument `preflight(snapshot, request)` executes synchronously before writes, no model I/O.
- `getTurn(id)`, `appendDelta(turnId,{text?,reasoning?},attemptEpoch)`, `appendEvent(conversationId,type,payload,turnId?)`, `events(conversationId,after=0)`.
- `finishTurn(turnId,{status,content?,reasoning?,usage?,error?,effects?,memoryProposals?},attemptEpoch)` commits terminal result, selected candidate/continuation or partial draft, event and releases active turn atomically; ignores/rejects late epoch or terminal callback. No duplicate finalization.
- `requestStop(turnId)`, `recoverInterrupted()`; reopening marks unfinished turns interrupted without resending external work.
- `command(conversationId,command)` -> Snapshot. Types conversation.configure, message.edit, message.delete, candidate.select, memory.edit, memory.lock, memory.confirm, fold.expand. Command carries `expectedContentRevision` for history/settings or `expectedBlockRevision` for memory. Active turn rejects manual mutation. History changes atomically invalidate dependent data, including transitive summary/fold refs.
- `commitDerived(conversationId,{summaries?,memories?,folds?,sourceRefs?,expectedMemoryRevision?,turnId?,attemptEpoch?})`: revalidate dependencies and locks. Idle commits only, except current-turn foreground compaction; return accepted proposal or conflict, never partial updates.
- `createJob({conversationId,kind,dependencies,payload})`, `listJobs(conversationId?)`, `updateJob(id,patch)`; dependency fingerprint dedupe.
- `recordTool({conversationId,turnId,memberRunId?,toolCallId,requestHash,name,args})` -> `{record,replayed}`; `finishTool(id,{status,result?,error?,usage?})`, `getTool(id)`. Unknown side effects not automatically replayed.
- `saveTrace({conversationId,turnId?,...trace})`, `getTrace(id)`, `listTraces(conversationId)`; `exportData()`, `restoreData(data)` (empty new store only), `close()`.

## Compiler, memory and retrieval ports

`compileContext(snapshot,{draft?,type?,countTokens?,workingBudget?,capabilities?,variables?,seed?,tools?})` in shared assembly/index.js -> `{messages,blocks,estimatedTokens,budget,omitted,effects,sourceRefs}`. messages use string content or typed media parts. Model SDK conversion is in executor. Compiler must reject required content over budget, never silently drop raw history. It can raise budget-blocked with compressible source refs, consumed by context service. Count fallback explicitly conservative estimate, no false exact counts.

`computeBudget({contextWindow,inputLimit?,maxOutputTokens,workingBudget})` in policy/index.js -> `{hardInputBudget,workingBudget,safetyTokens}`.

`createMemoryService({store,generate,now?})` in memory/index.js: `compact(snapshot,{signal,budget,turnId,attemptEpoch})`, `schedule(conversationId)`, `drain({signal}?)`; generate(request) injected, no direct SDK imports. Compute proposals outside transaction, store.commitDerived commits. Keep failed/ready/stale job states and at most one recomputation.

`createRetrieval({store,embed?})` in retrieval/index.js: `search(conversationId,query,{limit?,snapshot?})`, `index(conversationId,{signal}?)`, `rebuild(conversationId)`. Returned entries `{content,sourceRefs,score,method}` always revalidate current source versions. Index files only in explicitly supplied new data location; use memory if none.

## Execution, tools and runtime ports

`createPiExecutor({onRequest?}={})` in executors/pi/index.js exposes `runTurn({snapshot,requestPlan,connection,tools=[],limits,signal,beforeRequest,onEvent})` -> `{content,reasoning,usage,finishReason}`. onEvent({type,text?,...payload}) callback may be async, ordering/persistence awaited. beforeRequest(actualContext) invoked for every model call. No custom model/tool loop layered over SDK. Connection secrets never stored in events. Unsupported source/type rejected preflight.

`getCapabilities(connection)` in capabilities/core/index.js reports executor/provider/model/type/media/tool support and finite budgets. Explicit unknown combination disabled.

`createToolRegistry({store,retrieval,memory,resources?,image?,now?,random?})` in tools/index.js exposes `definitions({type,enabled?})`, `execute({turnId,conversationId,memberRunId?,toolCallId,name,args,signal})`. Definition `{name,description,parameters}` JSON schema. Six tool names per plan. Limits from shared TOOL_LIMITS. SDK converts definitions into its own tool format; MCP same registry. Tools never overwrite manual memory.

`createRuntime({store,executor,compile,memory?,retrieval?,tools?,trace?,groups?,capabilities?})` in runtime/index.js: `start(conversationId,request)` -> accepted `{turnId,status,contentRevision,eventCursor,replayed}` immediately; `stop(turnId)`; `estimate(conversationId,{draft,...options})`; `close()` aborts and joins active work. No provider I/O inside acceptance transaction. Runtime owns cancel controllers/deadline, captured epochs, persistence, preflight, compaction, event mapping and terminal commit. Auxiliary and impersonate return drafts, never user messages. Deterministic per-type handling. Integration with group service via frozen member requests.

## HTTP and browser port

`createRouter({store,runtime,capabilities,maintenance?})` in api/index.js returns Express Router. Paths relative to API_BASE: resources GET/POST; resources/:id GET/PATCH/DELETE; conversations GET/POST; conversations/:id GET/DELETE; conversations/:id/turns POST; turns/:id GET; turns/:id/stop POST; conversations/:id/commands POST; conversations/:id/estimate POST; conversations/:id/events GET; capabilities GET; traces/:id GET; conversations/:id/traces GET; maintenance endpoints. JSON error `{error:{code,message,details}}` with appropriate status. Events use SSE with id:seq and data:JSON, cursor query `after`; poll committed records, never in-memory-only publication. Schema version required on mutating bodies. Ownership uses existing authenticated request.user; no user-controlled filesystem paths. GETs do not create data.

New browser code in public/modern/conversation/ with core/client.js and core/state.js. A standalone new entry is provided during development; default Modern entry switches only in final stage. It never imports old actions/chat-generation.js, hidden iframe or old chat APIs. HTML textContent for all untrusted text. Secrets write-only. Buttons/loading/errors/conflicts/reconnect/partial replies visible; do not claim unimplemented features succeeded.

# Tool registry integration

`createToolRegistry({store,retrieval,memory,resources?,image?,now?,random?})`
provides `definitions({type,enabled?})` and `execute` from CONTRACTS.md. Enabled
may be a list of names or a map of explicitly true names. Default tools are
recall_memory, search_lore, roll_dice, get_time. update_memory and generate_image
are off. Continue/auxiliary/impersonate expose no tools. Group execution is under
the parent turn limits and uses `memberRunId` in intent dedupe.

Additional trusted orchestration methods:

- `bindTurn({turnId,snapshot,requestPlan?})`: call before tools, and per sequential
  group member, using the runtime's frozen snapshot and current compiled plan.
  Prevents reading newer resource versions and filters worldbook entries already
  included in `requestPlan.blocks` by `worldKey`. Rebinding updates member context but retains the parent turn's frozen limits,
  round, counters, start time and proposals. Without binding, the registry uses optional `store.getSnapshot`
  when present, otherwise the first active snapshot read from `getConversation`.
- `beginRound({turnId,conversationId,round})`: host execution layer sets a
  monotonically increasing integer 1..5 before each tool round. No model-facing
  argument can set it. Default is round 1, allowing at most 8 calls until advanced.
- `memoryProposals(turnId)`: collect proposals from completed calls, including MCP
  calls. Direct execute also returns `result.memoryProposal` (singular). Pass
  proposals to `finishTurn` only when status is completed. No direct memory write
  is performed by tools. Do not collect the same proposal through both paths.
- `toolArtifacts(turnId, memberRunId?)`: collect a deduplicated list of registered
  `{type:'image',attachmentId,mimeType,name,size}` from completed generate_image
  records. Optional memberRunId selects only that member; omission aggregates the
  whole turn. Runtime must collect before release and pass to `result.media` or
  that member's `commitMember`. Image-only successful replies still need a message.
  Every collection rechecks store.getAttachment; external URLs, missing records,
  non-images, unknown/failed calls and late output are excluded. Metadata comes
  from the registered attachment, never provider-supplied paths/bytes. Completed
  replays restore the collector without repeating the paid call.
- `release(turnId)`: release in-process counters/proposals after turn completion.

Image injection: `image({prompt,conversationId,turnId,idempotencyKey,recordId,memberRunId,snapshot,signal})`.
Return a JSON-serializable result, including `usage` when known. Credentials must
not appear in returned media/result data. Provider rejection errors can set
`definitive:true`; otherwise an invoked image call failing/timing out/aborting
records unknown outcome with incomplete/null cost. An unavailable injection is
a definite failure before external work. Unknown or unresolved persisted intents
are never automatically rerun. A durable result is recorded before returning;
oversized results return a bounded preview with `resultRef` referencing the full
stored tool record. Dice and time replays reuse stored results.

DATA's terminal transaction now classifies unfinished `intent`/`running` tools
as `unknown`, including stop/recovery (statically checked; not an integration-test
claim). `finishTool` still rejects late successful effects. Until the terminal
transaction runs, a rejected callback reports `tool-persistence-failed`; the
registry never silently claims its own write succeeded.

SDK-native host tools must be disabled by the executor adapter; this registry
only exposes the six listed domain tools and never executes host code.

## Frozen tool limits

Each session validates `snapshot.settings.toolLimits` before recording any tool
intent. Omitted fields use shared `TOOL_LIMITS` defaults, also enforced as hard
maxima. Overrides must be positive safe integers; unknown fields, null, arrays,
fractions, strings, non-finite values and values above the hard maxima are
rejected with `invalid-tool-limits`. A lower configured limit is never silently
replaced by the default.

The frozen session limits govern rounds, calls per round, total calls
(`rounds * callsPerRound`), tool timeout, remaining turn timeout and serialized
result bytes, including replayed results. Group-member `bindTurn` calls update
context without resetting or raising these parent-turn limits or counters.
Host `beginRound` numbering must therefore remain monotonic across the whole
parent turn, not restart at one for each member.

A positive result limit too small even for the stored-result reference returns
`tool-result-limit`. The full completed result remains persisted; this output
limit is not mislabeled as an unknown paid effect, and replay does not re-execute
the tool. No truncation loop can spin forever trying to fit the reference.

## Fatal outcomes and explicit image recovery

`tool-result-unknown` and `tool-persistence-failed` carry `fatal:true` and
`retryable:false`. `bindTurn({turnId,snapshot,requestPlan,onFatal?})` invokes the
callback synchronously on the first fatal outcome; `fatalError(turnId)` returns
that error for runtime checks before another model request or terminal success.
The registry refuses all further tool calls in that session. Executors must
propagate fatal errors and abort generation, never convert them to ordinary tool
result text. Runtime must wire `onFatal` to its controller and preserve the domain
error when finalizing. These flags alone cannot stop an SDK that swallows errors.

`store.listTools(conversationId)` must return persisted records including
`id,conversationId,turnId,memberRunId,name,args,status`. Before creating any image
intent on a retry, the registry walks every `request.retryTurnId` ancestor and
matches name plus canonical args. Unknown/running/intent matches block new charges.
Group identity uses persisted `plannedMembers[].{id,characterId}` (or completed
`members[].{memberRunId,characterId}`), so different members stay separate even
when prompts match. Missing identity is conservatively blocked; absent listTools
fails closed on image retries before external I/O.

`imageRecovery(conversationId,recordId)` returns
`{recordId,turnId,memberRunId,status,jobRecordId,canResume,canCancel,
resubmitAllowed:false,blockedReason?}`. It finds the unique provider-request job
whose `dependencies.origin` is that tool record; no opaque provider handle,
connection credentials, or provider calls are exposed here. A missing saved
handle returns `provider-job-handle-missing`. Composition/API own
`providerJobs.resume(cid,jobRecordId)` and `cancel(cid,jobRecordId)`, using the exact
saved handle, frozen connection, and original tool args.prompt. Resume never
submits a replacement job. Recovered images remain on job/tool records for UI
view/download; recovery does not rewrite the original assistant message.

Completed image records (including manually recovered records) also participate
in retry-chain matching. Identical args and the same member reuse the saved result
without generating or polling. The current turn receives a completed replay tool
record with `result.reusedFromToolId` and `usage:{cost:0,complete:true}`; registered
images attach only to the retry's member. Original records/messages and their
original charges remain unchanged. Cached replay still obeys call/result limits.
Missing cached images or unresolved member identity block automatic execution;
starting a genuinely new turn without `retryTurnId` is the explicit new-request
path. No additional composition or store port is needed beyond `listTools`.

Run the local fake-provider recovery/retry integration explicitly with
`node --test tests/conversation/integration/tools-recovery.test.mjs`.
It is included in `npm run test:conversation:integration` and makes no paid requests.

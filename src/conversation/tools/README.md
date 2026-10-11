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
- `release(turnId)`: release in-process counters/proposals after turn completion.

Image injection: `image({prompt,conversationId,turnId,idempotencyKey,signal})`.
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

# Memory injection and orchestration

`createMemoryService({store,generate,now?})` exports the contracted `compact`,
`schedule` and `drain`, plus `prepareCompact`, `combineProposals` and
`previewCompact`. No SDK or network client is imported.

The injected `generate(request)` receives `{type:'memory',snapshot,messages,
summaries,memories,sourceRefs,resourceRefs,budget,inputBudget,estimatedInputTokens,compressionPolicy?,signal,outputSchema}`. Return a parsed object
`{chapter,rolling?,memories?}`. Composition parses provider JSON at its boundary;
the memory service does not accept serialized response strings. Chapter and optional rolling summary
are nonempty strings capped at 16,000 characters each. At most 32 memory changes
are accepted, each content at most 8,000 characters. Each memory input uses
`{id?,expectedBlockRevision?,op?,kind?,content}`. Supported kinds are character,
relationship, world-state, timeline, user-fact. Updates/deletions require an
existing automatic unlocked block and its exact revision. IDs of new blocks are
server generated. Model-supplied references cannot override computed provenance.

`prepareCompact(snapshot,{signal,budget,turnId,attemptEpoch})` returns
`{proposal,snapshot}` without writing derived data. It excludes the latest
completed turn and existing valid folds, preserving complete turn groups. Runtime
may prepare a second batch against the returned snapshot. Both original snapshots
and persisted data remain unchanged if generation or final compilation fails.

`combineProposals(proposals,initialSnapshot)` accepts one or two sequential
proposals from the same turn/epoch and returns one proposal. Repeated updates to
one memory collapse to a single revision relative to the initial snapshot, with
source/resource dependencies retained. The temporary snapshots preserve the
initial conversation memoryRevision for the final compare-and-swap; individual
block revisions may advance provisionally during preparation.

`previewCompact(initialSnapshot,mergedProposal)` returns a pure snapshot with the
final merged block versions. Runtime must compile this final preview successfully
before calling `store.commitDerived(conversationId,mergedProposal)` exactly once.
This extra compilation is required even if the second temporary snapshot fitted.
Runtime owns the maximum of two foreground generation attempts.

`compact(snapshot,{signal,budget})` is the manual, idle-conversation operation:
it generates and atomically commits one proposal. Active conversations and turn
scope arguments are rejected before generation. It is not a foreground shortcut;
foreground runtime uses the deferred interfaces above.
A numeric `budget` (or `budget.summaryTokens`) bounds generated derived text using
UTF-8 bytes as a conservative token estimate, not the complete model request.

Before generation, the service reads the frozen connection selected by
`snapshot.settings.auxiliaryConnectionId`, defaulting to
`snapshot.settings.connectionId` only when the auxiliary field is absent.
Nested connection.data.auxiliary aliases and conversation.settings are not read.
Selection uses only frozen resources; absent or unconfigured selections block.
Shared `computeBudget` reserves output and safety tokens;
2,048 conservative input tokens are additionally reserved for the summary prompt.
Parents, memories and versioned source/resource references are counted using
serialized UTF-8 bytes. Earliest complete turns are added until the auxiliary
working input budget is reached. The request snapshot's message list is also
restricted to this batch; the caller's original snapshot is untouched. The
smallest complete turn not fitting returns `budget-blocked` without a provider
call. Composition must use the same selected connection and validate its actual
serialized request, since this module cannot see adapter-added prompts.

Parents are the newest valid rolling summary plus chapters not already covered
by it or newer chapters. Background extraction processes only new complete turns,
produces no folds, and does not hide the latest completed turn. Foreground
compression computes memory changes in the same atomic proposal, satisfying the
post-compression memory trigger without a second paid call. Summary, fold and
memory blocks all carry `resourceRefs` as well as `sourceRefs` so store can
invalidate them when selected characters/worldbooks/connections change.

`schedule` reads positive integer `snapshot.settings.memoryFrequency`, default 5,
and store deduplicates source/resource fingerprints. Jobs store ready proposals in `job.result.proposal`; no
provider call occurs inside transactions. `drain` is serialized per service,
keeps ready proposals during active turns, and resumes them without regeneration.
Ready results commit through `store.commitDerivedJob(jobId)` with no second
argument; store reads `job.result.proposal` and atomically commits derived data
and completed status. There is no split-commit fallback. Before recomputation,
`updateJob(jobId,{dependencies,result:{snapshot},status:'pending'})` must persist
both new dependencies and their deduplication fingerprint. The service checks
that updated dependencies were retained before generating again. A lost commit
acknowledgement is resolved from persisted job status; a still-ready proposal
retries only the local commit, without another model request.
Conflicts permit at most one recomputation. Jobs stopped during an unresolved
second attempt cannot restart a third computation. Failed jobs retain sanitized
error codes; source conflicts that exhaust the retry become stale.

Only fake-store unit tests have run. Final store atomicity, runtime budget
handling and auxiliary provider usage accounting require integration checks.

## Compression preferences and assembly contract

Foreground requests and proposals expose `compressionPolicy`: `compressionRatio`
(0.5), `targetTokens` (half the frozen primary working budget), `recentMessages`
(20), `recentTokens` (16384), `retainedMessageIds`, `retainedEstimatedTokens`,
`summaryTargetTokens` (half the batch and parent content), `summaryEstimatedTokens`
(on the proposal), `estimateMethod`, and `relaxReasons`. Values come from shared
`BUDGET_DEFAULTS`. Counts use conservative UTF-8 bytes, not actual tokenizer counts.
Composition must include these instructions in the auxiliary model request.

Keep a newest complete-turn suffix until 20 messages or the 16K preference is
reached; never split a turn. The latest complete turn always survives. If all
history is inside the suffix, release the oldest turn to permit progress. If the
suffix itself exceeds the half-budget target, release oldest turns until it fits
or only the mandatory final turn remains. Reasons explicitly record short history,
token cap, mandatory oversized turn, progress relaxation, target conflict,
auxiliary batching, and generated summaries exceeding the half-source target.
The 50% target is a preference; runtime's final compile enforces the hard limit.
Merged proposals retain per-pass metadata in `compressionPolicies` for traces.

Assembly owner: prefer the newest valid rolling summary, then chapters not covered
by it; do not duplicate their text. `summaryParents(snapshot)` already implements
this selection for generation. Validate transitive source/resource references
before applying the same priority in shared assembly. Memory never removes raw
history or commits based solely on its estimate.

## User-hidden source isolation

`eligible()` excludes `userHidden` raw messages before selecting turns or creating
background-job dependencies. `sourcesValid()` rejects hidden message references
even if revision/candidate identifiers have not changed. Consequently direct and
transitive dependent summaries/memories are excluded from auxiliary requests,
parent selection and searchable entries even when their stored status is still
`valid`. Prepared proposals also fail preview validation if a source becomes
hidden. Automatic memory proposals cannot use hidden sources; hiding never deletes
raw history or clears the user's hidden flag. `update_memory` uses visible sources
only. A still-visible message in the same turn remains independently eligible.

Focused evidence: memory/tools units and
`tests/conversation/integration/memory-hidden.test.mjs` pass with a local fake
HTTP provider. The latter checks actual auxiliary request bodies after hiding a
message that already had derived summaries and memory. No paid provider is used.

## Auxiliary batch accounting regression

Batch selection measures the actual composition payload (`messages`, `summaries`,
`memories`, `compressionPolicy`) serialized inside a chat request, including JSON
quote/backslash escaping and the prompt reserve. Top-level proposal provenance
(`sourceRefs`, `resourceRefs`) is not sent separately by composition and must not
be counted again. References embedded in messages or derived blocks are counted.
All protected memories remain in the input. Whole-turn prefix search is bounded
and never truncates an individual turn.

A blocked smallest batch reports `stage:auxiliary-batch`, a reason distinguishing
fixed context from the earliest complete turn, `fixedEstimatedTokens`,
`minimumBatchEstimatedTokens`, the selected connection budget and prompt reserve.
A primary 32k condition does not imply that its auxiliary request can hold 160
protected memories; use an explicit independently budgeted auxiliary connection.

Offline full-dataset regression (3040 messages, 160 locked memories) uses injected
short summaries, not a model-quality result. Two corrected 950k batches cover
3019 messages; actual auxiliary compiler estimates were 948769 and 765771. The
resulting main context was 39385: 64k/128k fitted, while 32k correctly remained
budget-blocked under the retained recent-history preference. No protected memory
or dataset record was removed to make this test pass.

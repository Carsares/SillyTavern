# Memory injection and orchestration

`createMemoryService({store,generate,now?})` exports the contracted `compact`,
`schedule` and `drain`, plus `prepareCompact`, `combineProposals` and
`previewCompact`. No SDK or network client is imported.

The injected `generate(request)` receives `{type:'memory',snapshot,messages,
summaries,memories,sourceRefs,resourceRefs,budget,inputBudget,estimatedInputTokens,signal,outputSchema}`. Return an object or
JSON string `{chapter,rolling?,memories?}`. Chapter and optional rolling summary
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

`compact(snapshot,options)` remains a compatibility wrapper that prepares and
immediately commits. Foreground runtime uses the deferred interfaces above.
A numeric `budget` (or `budget.summaryTokens`) bounds generated derived text using
UTF-8 bytes as a conservative token estimate, not the complete model request.

Before generation, the service reads the frozen connection selected by
`settings.auxiliaryConnectionId`, then primary.data.auxiliary.memory/summary/
summarization (in that order, string or {connectionId}), then settings.connectionId.
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

# Memory injection and orchestration

`createMemoryService({store,generate,now?})` exports the contracted `compact`,
`schedule` and `drain`. No SDK or network client is imported.

The injected `generate(request)` receives `{type:'memory',snapshot,messages,
summaries,memories,sourceRefs,resourceRefs,budget,inputBudget,estimatedInputTokens,signal,outputSchema}`. Return an object or
JSON string `{chapter,rolling?,memories?}`. Chapter and optional rolling summary
are nonempty strings capped at 16,000 characters each. At most 32 memory changes
are accepted, each content at most 8,000 characters. Each memory input uses
`{id?,expectedBlockRevision?,op?,kind?,content}`. Supported kinds are character,
relationship, world-state, timeline, user-fact. Updates/deletions require an
existing automatic unlocked block and its exact revision. IDs of new blocks are
server generated. Model-supplied references cannot override computed provenance.

`compact(snapshot,{signal,budget,turnId,attemptEpoch})` excludes the latest
completed turn and existing valid folds, preserving complete turn groups. It
submits summaries/memories/folds in one `commitDerived` call, including epoch and
all transitive message/parent-summary dependencies. A numeric `budget` (or
`budget.summaryTokens`) is checked using UTF-8 bytes as a conservative token
upper estimate for generated derived text. This is not a count of the complete
model request. Runtime must recompile and enforce the final request budget, with
at most two compaction attempts as specified by the contract.

Before generation, the service reads the frozen connection selected by
`settings.auxiliaryConnectionId ?? settings.connectionId` (or the sole connection
when neither is set). Shared `computeBudget` reserves output and safety tokens;
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
Conflicts permit at most one recomputation. Jobs stopped during an unresolved
second attempt cannot restart a third computation. Failed jobs retain sanitized
error codes; source conflicts that exhaust the retry become stale.

Only fake-store unit tests have run. Final store atomicity, runtime budget
handling and auxiliary provider usage accounting require integration checks.

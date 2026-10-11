# Retrieval injection

`createRetrieval({store,embed?})` exports `search`, `index`, `rebuild` per contract.
The optional injected `embed({texts,purpose,signal?})` returns
`{model:string,version:string,dimensions:integer,vectors:number[][]}`; purposes
are `index` and `query`. Provider/model configuration changes must change model
or version. Vectors must be finite, nonzero and dimension-consistent.

Index and query model/version/dimensions must match. Concurrent builds use a
monotonic generation to prevent an older build overwriting a newer one. Indexes
are in memory and reconstructible; no filesystem paths or old data are read.

`index` embeds in batches of at most `EMBED_BATCH_SIZE` (96) inputs and
`EMBED_BATCH_BYTES` (256 KiB of UTF-8) each; a single larger input is sent
alone. Vectors are reused by content fingerprint while model, version and
dimensions stay the same, so a reindex embeds only new or edited entries;
`rebuild` and a query embedding mismatch discard them.

Keyword search uses current selected history, valid summaries and memories,
including folded history. Semantic results are intersected with the requested
snapshot and then a fresh store snapshot after query embedding finishes. Content,
source versions, candidate versions, derived revisions and transitive parents
are rechecked. Entries report `keyword`, `vector` or `hybrid`; model mismatch or
query-embedding failure retains keyword results. `index` returns metadata or
`keyword-only`. A semantic-readiness UI must use that status; keyword-only results
are not evidence of an operational embedding provider.

`search(conversationId,query,{snapshot,limit,signal})` forwards `signal` unchanged
to the query embed injection. Already-aborted searches never start embeddings;
abort errors and late results after cancellation are propagated instead of
returning keyword fallback. Ordinary provider failures still retain keyword
results. The injected provider must honor the signal to cancel its HTTP work.

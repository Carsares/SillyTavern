# Evaluation integration handoff (2026-10-11, static inspection only)

Writable scope covers evaluation, memory and tools; no composition/provider/store changes
were made. These findings are for the parent and Linnaeus. The app messaging tool
rejected delivery to the native parent task; no native subagent messaging tool was
available. This file and the final handoff are the delivery record, not a claim
that a message reached Linnaeus.

## Memory connection selection aligned

`src/conversation/memory/budget.js`, `auxiliaryBudget`, now follows composition:
explicit settings.auxiliaryConnectionId, then the frozen primary connection's
auxiliary.memory/summary/summarization (string or {connectionId}), then primary.
Missing selected resources block instead of selecting a different/larger budget.
An unconfigured sole resource no longer silently supplies a connection; fake
stores now explicitly configure the primary, matching actual composition input.
Unit coverage verifies precedence, frozen limits, missing resources, bounded
complete-turn batches and retained resource revisions.

## Concurrent fixes observed; no longer reported as missing

- `generateMemory` now reads object inputBudget.workingBudget/hardInputBudget,
  checks its frozen connectionId, and keeps actual request validation. Its JSON
  instructions now include id/expectedBlockRevision for updates and deletes.
- Runtime collects `toolArtifacts(turn.id, member?.id)` and store accepts
  result.media/input.media. The collector delivered in this task supplies only
  registered image references; external URLs deliberately remain tool artifacts.
- Auxiliary image adapter now accepts `idempotencyKey` as metadata.
- Composition now uses `prepareProviderJob` for Horde text/image. That helper
  persists an intent before submission and saves jobId through `onJob`, blocks
  retry without a saved ID, and supports resuming the known ID. Text adapter
  defaults jobId/onJob from the bridge options; image adapter receives both.
  This is static confirmation of wiring, not integrated crash/recovery evidence.
- Runtime passes frozen toolLimits to the executor; registry independently
  enforces its validated per-turn limits. Store terminal intent-to-unknown
  behavior remains owned by DATA.

## Evaluation-specific hooks and blockers

`createEvaluationAdapter` dynamically imports real composition/store/memory and
retrieval. It uses `runtime.start/wait`, store export/restore, injected fetch and
factory seams. It waits for tracked background memory/index operations and closes
services. Native evaluation requires no HTTP listener; real SDK runs use their
existing random local gateway listener. Full-history requests reject compaction.

Native, Anthropic and Responses egress is guarded before every HTTP attempt.
Claude/Codex now use their existing gateway fetch injection and enforced process
isolation with the same shared ceiling. Unit tests invoke real SDK executor and
gateway handlers with fake SDK/process/transport boundaries; no listener is started. Cold/warm remain blocked until
actual provider cache isolation can be proven; local session IDs do not suffice.
An explicitly labeled uncontrolled-cache baseline is available. No real provider,
server integration, SDK child process, or paid evaluation was executed here.


## Tool artifact interface delivered

`tools.toolArtifacts(turnId, memberRunId?)` returns only registered image refs:
`{type:'image',attachmentId,mimeType,name,size}[]`. It deduplicates IDs, reads
metadata from store.getAttachment, excludes external URLs and failed/unknown
calls, and revalidates registration when collected. Optional memberRunId filters
exactly that member; omission returns the whole turn. Call before tools.release.
Completed replay rehydrates collection without calling the provider again.
Oversized SDK-visible tool results do not truncate this artifact list.

The parent runtime now collects per-member media. Store's result.media/commitMember
support is now present; its contract includes image-only successful replies as well as text+image replies.
This task does not modify either owner's files or assert integrated persistence.


## Validation evidence

Executed only pure units:
`node --test --test-concurrency=6 tests/conversation/modules/memory/*.test.mjs tests/conversation/modules/retrieval/*.test.mjs tests/conversation/modules/tools/*.test.mjs tests/conversation/modules/mcp/*.test.mjs tests/conversation/evaluation/*.test.mjs`

107 tests passed, 0 failed, exit 0. SDK tests replace process/start/network
boundaries; they do not launch servers or SDK binaries. Local credentials were
not read or used. Paid runs, full evaluation and integrated attachment persistence
remain unexecuted. No branch/worktree/commit was created by this task.

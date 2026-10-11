# Conversation store

The store opens only a new empty SQLite database or storage layout **3**. An
unsupported or unversioned nonempty database fails with `schema-version` before
schema initialization. There is no migration, conversion or compatibility path.
Use a new `conversation-v1` directory for this project.

## Command identifiers

`fold.expand` addresses a fold by `foldId`; `memory.edit`, `memory.lock` and
`memory.confirm` address a memory by `blockId`, matching the UI commands in
`public/modern/conversation/memory/view.js`. The old `id` and `memoryId` command
aliases are rejected with `invalid-command`, including requests that also supply
the canonical field. Fold requests may still carry the UI's `blockId` and
`expectedBlockRevision` metadata; fold addressing uses only `foldId`. Existing
version checks and defaults such as omitted `locked` meaning `true` are retained.

## Trace persistence

- `traces` holds the trace header, request plan and terminal status/usage. The
  header retains an empty `events` array when the public trace has that field.
- `trace_events` holds ordered event JSON, keyed by `(trace_id, seq)`.
- `trace_streams` holds the small status and next-sequence record. Appending an
  event reads this record, without reading or rewriting the request plan.
- `appendTraceEvent(traceId, event)` commits the event and sequence increment in
  one synchronous transaction and returns `{traceId, seq}`. Failed transactions
  leave neither an event nor a sequence gap. Only running traces accept events.
- `saveTrace` creates or updates the header and can replace an explicit events
  array. Unchanged event prefixes are retained. It is intended for creation,
  metadata updates and terminal saves, not per-delta trace snapshots.
- `getTrace` and `listTraces` assemble event rows into the existing public trace
  shape. Each successfully appended event is immediately available to readers.
- Trace detail pruning removes event rows while preserving usage accounting;
  pruned traces reject further events. Conversation deletion removes both trace
  headers and their internal event/state rows.

`createTraceService` retains only active trace identifiers and ownership metadata
in memory. `record` redacts and synchronously appends one event. `finish` and
`fail` save terminal metadata before releasing the active entry, so database
failures propagate rather than silently discarding terminal evidence.

## Backup contract

The logical backup remains `schemaVersion: 1` with the existing `secretSchema`.
It contains assembled `traces[id].events`, not internal `trace_events` or
`trace_streams` tables. Restore validates event arrays before writing and rebuilds
the physical trace tables inside its existing transaction. The SQLite storage
layout version and logical backup schema version are separate contracts.

## Focused verification

```sh
node --test --test-concurrency=1 tests/conversation/modules/store/trace-persistence.test.mjs tests/conversation/modules/resources/maintenance.test.mjs
```

These are small, offline functional tests for append writes, terminal evidence,
rollback, reopen, restore, pruning and schema rejection. They are not paid model,
large-history performance or end-to-end integration evaluations.

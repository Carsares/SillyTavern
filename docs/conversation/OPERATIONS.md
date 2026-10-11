# Conversation v1 operations

## Data and startup

Use Node.js >=22.19 and install the locked dependencies with `npm ci`. `npm start` starts the new server on loopback port 8000. `--dataRoot /absolute/path` selects a root containing `default-user/conversation-v1`. Do not point it at an old database or attempt manual schema conversion. Two processes must not open the same new workspace.

Connection keys belong in the resource editor. Public resource reads, snapshots and traces omit credentials. The data directory and backups with credentials are sensitive. For remote access, set `CONVERSATION_PASSWORD`, choose `--host`, specify `--allowed-host` for the browser hostname and terminate HTTPS at a trusted reverse proxy. Forward the original Host header. The server does not trust forwarded authentication headers.

## Backup and restore

The ordinary export contains only current effective history and referenced attachments; it is not a restore backup. Stop active generations before making a backup. The maintenance interface creates a versioned backup containing resources, immutable history, events, derived state and attachment bytes/checksums. Credentials are excluded by default; explicit inclusion changes the sensitivity of the resulting file. A backup without credentials requires reconfiguring connections after restore. Proxy URLs are always omitted, even with credential inclusion, and must be configured again.

Restore into an empty new workspace. The server validates schema, cross-entity references, file identifiers and hashes before database import. Database import is transactional. If a restore is interrupted after writing attachment bytes, a retry may reuse exactly matching files; it must not overwrite different contents. Rebuild retrieval indexes after restore.

The browser JSON backup format accepts up to 256 MiB including its restore envelope; backup checks the same limit. Ordinary mutation bodies remain limited to 20 MiB. For a larger workspace, stop the server cleanly and preserve the entire conversation-v1 directory together (database, any SQLite companion files and attachments); restore that directory into an unused location with the same schema version before restarting. Never copy a live database file by itself.

File cleanup requires a fresh preview token. Cleanup rechecks that the candidate set is unchanged and generation is idle. Only sufficiently old unreferenced files qualify. Referenced attachments, retained candidate history and backups are not a generic cleanup target. Registered attachments without any retained reference can be reclaimed. Trace-detail retention is separately previewed; pruning keeps accounting records. Trace byte statistics are UTF-8 JSON logical sizes, not physical SQLite file sizes.

## Interrupted generation

Browser disconnect does not imply generation failure. Reopen the conversation to read the persisted turn and event cursor. Stop requests persist cancellation and abort external work. Already committed nonempty text remains a partial result; a stopped regenerated candidate or continuation does not silently replace the selected original.

After process restart, unfinished turns become `interrupted`, activity ownership is released and persisted partial output is recovered. No model request or paid tool is automatically resent. Unknown paid-tool results remain unknown until explicitly resolved; deduplication prevents a second charge from a replayed call. The image job panel can query or cancel an existing saved provider handle. Missing handles never trigger a replacement submission. Query completion persists recovered attachments without rewriting the old failed turn; a retry can reuse the completed image without another charge. Cancellation means cancellation was requested, not that the provider confirmed no charge. Automatic group scheduling defaults to off after restart and stops on a failed/stopped turn.

## Diagnosis

Use context diagnostics to inspect included layers, sources, omitted optional blocks and estimated input budget. Estimates are distinct from service-reported usage. Missing token counts or prices are unknown, not zero. Request traces redact credentials and preserve the request/response metadata needed to compare model steps.

For `budget-blocked`, inspect mandatory source blocks and auxiliary-model limits. Increasing the main model budget does not increase the auxiliary connection's window. Compression may fail if even one complete source turn cannot fit the auxiliary input budget. Preserve the original conversation and adjust explicit settings; do not delete history to disguise a budget failure.

For revision conflicts, reload current state and review the pending edit. The client does not automatically resend stale writes. For unavailable SDK/platform combinations, use capability diagnostics; support is not inferred from installing a package alone.

## Validation status

Read IMPLEMENTATION.md and VALIDATION.md before treating a path as accepted. Module tests, local protocol simulations, browser scenarios and real connection checks prove different things. Paid quality matrices and budget-limit experiments were cancelled by the user; do not run them as delivery validation. No mock test establishes real-model quality, cost or latency.

## Connection proxies and indexing

A connection may configure a write-only `proxy:{url}` with an HTTP/HTTPS root URL
and optional encoded authentication. Omission preserves the existing value;
`proxy:null` clears it. Parent-owned transports do not inherit proxy environment
variables, disable TLS verification, follow redirects or fall back to a direct
connection. SDK children still connect only to their local gateway. Downloading
external generated-image URLs follows the separate public-HTTPS/DNS-pinned policy.
Production HTTPS proxy connectivity remains unverified.

History, summary and resource changes schedule semantic index refresh after the
transaction commits. The interface distinguishes keyword-only, not-ready,
indexing, ready, stale and error states. Keyword retrieval continues to validate
sources if the semantic provider is unavailable. User-hidden messages and
summaries/memories depending on them are excluded from generation, retrieval and
automatic summary inputs. Expanding a fold does not undo user hiding.

Summary editing checks the block revision and invalidates dependent derived data.
Foreground compression prefers the recent 20 messages within 16K estimated tokens,
keeps complete turns, targets about half of the working budget, and records why
preferences had to be relaxed. The hard request budget remains authoritative.

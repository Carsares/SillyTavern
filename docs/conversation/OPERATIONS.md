# Conversation v1 operations

## Data and startup

Use Node.js >=22.19 and install locked dependencies with `npm ci`. `npm start`, `start.sh`, and `Start.bat` start the complete Modern application through `server.js`; `/` defaults to `/modern/`. Existing pages, resources, extensions, generation paths and data remain in service. Open the additional Agent navigation item for the new conversations.

The original `CommandLineParser` owns `config.yaml`, `--configPath`, `--dataRoot`, port/listen options and security configuration. Agent APIs inherit existing session authentication and CSRF protection. Configure remote access through the original authentication/Host-whitelist settings and a trusted HTTPS proxy. The main application does not use `CONVERSATION_PASSWORD` as a substitute for its authentication. Scripts do not reset mounted configuration or inject credentials.

Agent storage is `<authenticated user's data directory>/conversation-v1/`. Credentials and backups remain sensitive. Agent does not import or rewrite original chats; the full application retains its own normal configuration/data initialization. Do not allow multiple processes to open the same Agent directory. Agent backup/restore covers Agent data only, not the entire application's existing chats, settings or extensions.

### Optional standalone service

`npm run start:agent -- --port 8001 --dataRoot /absolute/isolated-data` runs `conversation-server.js` separately. Its default UI is `/modern/conversation/`, and its storage is `default-user/conversation-v1` below the selected root. Only this mode uses `CONVERSATION_PASSWORD`, `--host` and `--allowed-host`; remote listening requires explicit password/allowed hosts. Keep its port and data separate from the full application. `npm run init:agent` initializes only the standalone Agent workspace; `npm run init` retains the original application's initialization script.

### Docker deployment

Docker uses the upstream SillyTavern packaging unchanged: `Dockerfile`, `docker/docker-entrypoint.sh` and `docker/docker-compose.yml`. `COPY . ./` ships the full application, so Agent code is included; Agent data is stored under the mounted data directory at `<user>/conversation-v1/`. Mounts, `PUID`/`PGID`, `--listen`, `npm run init` and the heartbeat healthcheck behave as upstream. `.dockerignore` additionally excludes gitignored local files (`/config.yaml`, `/output`, `/test-results`, `.playwright-cli`, `.claude`, `.codex`) so local credentials and tool output never enter image layers.

The Linux container runs the native PI executor only. Claude/Codex SDK isolation is macOS-only, so those executors return `unsupported-isolation-platform` there. Data from a previous standalone `/data` volume is not imported automatically. Container validation passed with `python3 -I docker/validate-conversation.py`; see VALIDATION.md.

Where Docker Hub is unreachable, do not edit the Dockerfile. Pull the base image from a mirror, compare its digest with a second mirror, and tag it under the upstream name before building:

```bash
docker pull docker.m.daocloud.io/library/node:lts-alpine3.23
docker buildx imagetools inspect docker.1ms.run/library/node:lts-alpine3.23
docker tag docker.m.daocloud.io/library/node:lts-alpine3.23 node:lts-alpine3.23
```

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

Read IMPLEMENTATION.md before treating a path as accepted. Module tests, protocol simulations, browser scenarios, installed-SDK execution and paid quality evaluation prove different things. The evaluation runner requires explicit connection configuration and admission budgets. No mock test establishes long-conversation quality, cost or latency against real models.

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

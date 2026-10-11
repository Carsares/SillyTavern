# Conversation v1 validation evidence

All checks use the current master workspace. Unit and integration data is generated
inside dedicated temporary directories. Existing conversations and credentials are
not copied into the new application. The separate live check has explicit user
authorization to read only the selected connection credentials in memory.

## Current cleanup verification

See [new-application cleanup](CLEANUP.md) for the current revision: 649 offline
functional units passed; 57 of 58 local integration scenarios passed initially,
and the one outdated restore-request test was corrected with all 16 HTTP
integration tests passing on rerun. The retained 42 other scenarios had already
passed. Final PI/adapter checks passed 63 tests. No paid or long-history quality
checks ran. Counts below describe earlier revisions and overlap later reruns.

## Completed checks

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| New-code lint | Passed | `npm run lint:conversation`, exit 0 |
| Complete unit suite | Passed | `npm run test:conversation:unit`: 664 passed, 0 failed, exit 0. This includes protocol transport mocks, not real providers. |
| Store/runtime consistency integration | Passed | `node --test tests/conversation/integration/consistency.test.mjs`: 9 passed, exit 0. Includes real SQLite, competing write processes, SIGKILL and reopen recovery. |
| HTTP/application integration | Passed | `node --test tests/conversation/integration/http.test.mjs`: 13 passed, exit 0. Real local HTTP, PI loop, tool execution, media persistence, generation types and memory flows; deterministic local model peer. Includes replay cursors, 409 conflicts, redaction and restore bodies over 20 MiB. |
| Default server process and access controls | Passed | `node --test tests/conversation/integration/server.test.mjs`: 7 passed, exit 0. Isolated init/restart, root redirect, healthcheck, Host/Origin/CSRF checks, remote password enforcement and legacy API rejection. |
| Browser chat and usage | Passed for inspected scenarios | Headless browser sent `USE_DICE`, observed completed tool round and two model requests totaling 50 reported fixture tokens. Mobile 390×844 trace view inspected. These numbers describe the local protocol peer only. |
| Browser resource and maintenance flows | Passed for inspected scenarios | Six resource kinds created/edited/deleted with readback; settings binding; manual memory create/edit/lock; attachments upload/edit/remove; candidate/regenerate/continue; auxiliary and impersonation drafts; single-member group; stop/reload preserving partial text; backup/export parsing, index rebuild and cleanup preview. Desktop and 390px mobile screenshots in `output/playwright/child-*.png`; no console errors/warnings in the final independent session. The initial browser pass did not exercise cleanup/restore; the final scope pass below did. |

Counts from overlapping reruns must not be added together. Later fixes require
the affected checks to run again; stage commits do not themselves prove acceptance.

## Installed SDK and real connection checks

- Final `npm run test:conversation:integration`: 58 passed, 0 failed, 0 skipped,
  exit 0. This includes 16 HTTP, 9 consistency, 7 server, 22 installed-SDK/isolation,
  and four explicit image-recovery/hidden-memory/proxy/retry tests. The earlier
  table records narrower runs; do not add overlapping totals.
- Both installed SDKs passed text, domain-tool continuation, second-request budget
  denial, initial budget denial, abort and forbidden host-tool scenarios using
  deterministic local protocol peers. Both installed SDKs also passed actual local authenticated HTTP proxy routing.
  Two-message requests using the selected
  DeepSeek model name also passed. OS checks include gateway-only networking,
  host-file and unrelated-command denial; temporary directories and listeners
  are checked after completion. Codex is pinned to 0.156.1; the initial 0.160.0
  run failed six Codex scenarios during managed-preferences initialization.
- Real selected connection: `api.deepseek.com`, configured model
  `deepseek-v4-flash`. Native PI, Claude Agent SDK and Codex SDK each returned
  the expected `OK`, with one provider request each and reported usage of
  24 input + 1 output tokens per request. Total: three dispatched requests,
  75 reported tokens. No dollar cost was returned or inferred.
- Initial Claude execution failed `unexpected-sdk-context` before dispatch.
  After a local reproduction and strict environment-block adaptation, the
  Claude/Codex live command exited 0. Evidence retained locally in
  `test-results/conversation-live-pi-claude-initial.json` and
  `test-results/conversation-live-sdk.json`. Credentials are absent from reports.
  Live tests cover text connectivity only; tool/failure paths use local peers.
- SDK built-in OS isolation is currently macOS-only. Linux/Windows SDK runtime
  support is not claimed; native PI remains independent of that SDK backend.

## Container validation remains blocked

Two build attempts failed while fetching `node:24-bookworm-slim` from Docker Hub
with EOF. No image/container/volume was created. Container runtime checks are
therefore unrun; `docker/validate-conversation.py` retains the isolated validation
procedure. Local Docker is desktop-linux, Linux arm64, server version 29.2.1.

## Cancelled paid quality evaluation

The user cancelled long-conversation quality and budget-limit testing. These
experiments are no longer delivery prerequisites and must not resume from old
plan entries. Functional verification uses synthetic local provider peers; the
three earlier real short replies remain connectivity evidence only.

A later pre-dispatch attempt made zero provider requests. One separate Codex
long-history diagnostic dispatched one request and timed out without a scored
answer. Its reserved maximum was USD 0.3073728; actual billing is unknown. No
automatic retry was made. Local evidence is in
`test-results/evaluation-10usd-codex-full/report.json`.

This document does not claim model-quality thresholds or verification of every
provider/platform combination.

## Final browser scope pass

The isolated browser verified summary editing, user hide/restore, image-job
query/cancel and returned attachments, semantic index error/recovery, write-only
proxy update/clear, maintenance statistics, actual cleanup, effective-history
export and full backup restore into an empty workspace. The local image peer
recorded one original submission and one cancellation, with no repeated chargeable
submission. The 390px mobile page had no horizontal overflow. Screenshots are
retained in `output/playwright/child-scope-*.png`. Test processes and browser were
closed. After inspection, raw task diagnostics/events were collapsed by default;
all 68 client tests and the affected lint check passed again.

## Final scope corrections

The final scope audit found real implementation gaps despite earlier passing
checks. These were fixed before the 664/58 final run: folded source recall,
commit-triggered semantic index refresh, fatal unknown-tool handling, persisted
image query/cancel and retry reuse, recent-history compression preferences,
rolling-summary selection, summary editing, user hiding, effective-history
export, reference-aware attachment cleanup, trace-detail retention, explicit
connection proxies, and reported/estimated currency accounting. Targeted
regressions and local HTTP tests cover these corrections. Existing real
connection evidence remains limited to the three bounded text requests above.

The DeepSeek example evaluation configuration remains disabled with zero budget.
Its documented model alias resolves to DeepSeek-V4.1-Flash with a 1M window;
the old local 4095-token setting was not changed. The provider does not offer
verified cold/warm cache control through this harness, and the model alias is
not an immutable model revision. An uncontrolled-cache run would be explicitly
a diagnostic 36-condition matrix, not a pass for the planned 72-condition G5 gate.
Source: [DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing/).

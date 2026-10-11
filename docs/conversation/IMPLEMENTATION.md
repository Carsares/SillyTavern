# Conversation v1 implementation and evidence

All work remains on master in the original workspace. Initial clean baseline: `6555a215a`. No branches, worktrees, pushes or deployments were created. New functionality does not migrate or read legacy user data.

## Current stage

Feature implementation and module contract review reached the final integration stage after focused unit checks. Local HTTP/database and browser validation passed the inspected scenarios; installed SDK integration and three bounded real connection checks passed. Container builds failed during the base-image fetch. Real-model quality/cost/latency evaluation has not run. See VALIDATION.md for check-specific evidence. A module commit is not acceptance of the complete product. The user's testing order is authoritative: focused unit tests during development, full integration after all feature changes are ready.

## Committed stages

| Stage | Commit | Evidence recorded at commit |
| --- | --- | --- |
| New protocol and isolated test helpers | 52983a3cb | 3 protocol unit tests passed |
| Pure context compiler and budget policy | ed4edf65f | 28 context unit tests passed |
| Lifecycle APIs, resources, maintenance | c9f7007b7 | Focused runtime/resource tests passed |
| pi dependency and Node baseline | 845d792c7 | Node 26.10.0, SQLite 3.53.4, exact pi 1.0.2 imports verified; Node >=22.19 declared |
| Native pi execution and provider injection | a63822e68, 7a296a8fa, ea67af076 | Agent-reported focused unit tests; final integration pending |
| Generation context, media and retrieval | 6470e474f | Combined context/runtime/resources: 40 passed |
| Chat/text/auxiliary codecs and streaming | eaf9e2129 | 78 provider unit tests passed with injected transport |
| Automatic groups and resumable file restore | e05b9f556 | 12 runtime/resources tests passed |
| SQLite versioned entities and atomic lifecycle | b5b227e74 | 37 store unit tests passed, including 1500+ retained messages |
| Memory, retrieval, domain tools and MCP | 20be34bb9 | 55 unit tests passed |
| Independent Modern interface | 9a1c5f5d6 | 28 client unit tests passed; browser unrun |
| Measured usage aggregation | 7fa61e9d9 | 3 usage tests passed; 15 related runtime/resources tests passed before final focused rerun |
| Scheduling preflight, manual compaction revisions and bounded backup | d17f187ce | Focused runtime/resources checks passed |
| Unified SDK gateway and Claude/Codex adapters | 0cce08840 | 37 SDK unit tests passed; installed SDK execution still pending |
| Standalone application composition and default server entry | 46bdb5e9e | 19 composition unit tests passed |
| New installation and container entry | 93bfbe821 | Script syntax checked; container build unrun |
| UI contract, usage and tool/candidate controls | 160e2113b | 46 client unit tests passed |
| Versioned source history and persisted output attachments | 57dee8ea2 | 109 focused runtime/store/client unit tests passed |
| Named auxiliary providers and persistent job protocols | 35a0bc896 | 168 provider unit tests passed, including 61 auxiliary tests |
| Native reasoning/media/text protocol completion | afca89521 | 185 provider unit tests passed, including offline NovelAI tokenizers |
| Atomic group effects, speculative compression and source editor | 0ba98d04b | 192 focused store/runtime/memory/context/client unit tests passed |
| Bounded evaluation, domain artifacts and auxiliary usage | 38a2dba37 | Complete unit suite passed before commit; quality evaluation unrun |
| Media/job composition and inclusive PI usage | f38888b21 | Complete unit suite: 582 passed; local HTTP integration: 9 passed |
| Full local integration and container validation procedure | c68823498 | Combined HTTP, consistency and server integration: 29 passed, exit 0 |
| Browser connection capabilities and static icon | 1de65f21a | Client unit suite: 57 passed; inspected browser scenarios passed |
| Installed SDK compatibility and bounded live connection checks | fb73bc57c | Three real requests passed; initial local integration: 47 passed |
| Final consistency, recovery, maintenance, proxy and accounting corrections | fd5005948 | Final suite: 664 units and 58 integrations passed, lint exit 0 |
| Summary, job recovery, retrieval, proxy and maintenance interface | 802e3e4e4 | 68 client tests passed; new browser scenarios including restore/cleanup passed |

Numbers overlap between reruns and must not be added into a claimed distinct-test total.

## Remaining acceptance work

- Local scope corrections and phase commits are complete. See VALIDATION.md for
  664 passing unit tests, 58 passing integration tests, inspected browser scenarios
  and three real connection checks. The last presentation-only change passed
  all 68 client tests and affected lint checks.
- Retry container validation after base-image registry access is available.
- Run the long-conversation matrix (32K/64K/128K/full, cold/warm, at least three
  repeats and all executors) with frozen model versions, exact expected answers
  and measured usage. Harness unit tests do not prove quality.
- Record unsupported or unverified platform/provider combinations explicitly.
  Default working budget remains provisional until quality/cost/latency acceptance.

Three paid model requests completed using the user's existing selected connection:
native PI, Claude Agent SDK and Codex SDK each returned the expected OK, with
reported usage of 24 input and 1 output tokens. The initial Claude attempt failed
context validation before dispatch; the local reproduction was fixed before its
single successful provider request. No credentials were persisted in test output.

This authorization does not set a spending ceiling for the full repeated
long-conversation matrix. That ceiling and compatible model windows must be
confirmed at the final evaluation stage. The existing local setting uses a 4095
token context window and cannot directly satisfy the planned 32K/64K/128K matrix.

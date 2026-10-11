# SDK executors: composition integration

Public factories are `createClaudeExecutor({fetch,onRequest})` from `../claude/index.js`
and `createCodexExecutor({fetch,onRequest})` from `../codex/index.js`.
Both expose synchronous `preflight({connection,requestPlan?,limits?})`,
`getCapabilities(connection)`, and:

```js
await executor.runTurn({
    snapshot, requestPlan, connection, tools: [], limits, signal,
    beforeRequest: async actualContext => {},
    onEvent: async event => {},
});
// => {content, reasoning, usage, finishReason, toolStates, capabilities}
```

`connection` accepts the frozen resource or its `.data`. Supply model, baseUrl,
contextWindow, workingBudget, maxOutputTokens, optional inputLimit/outputLimit,
apiKey/headers, reasoning and historyMode. Claude baseUrl may end in `/v1` or be
the API origin; Codex baseUrl must be the Responses API base (normally `/v1`).
These executors speak Anthropic Messages and OpenAI Responses respectively;
they do not claim to convert unrelated provider protocols.
`requestPlan.messages` must contain the complete compiled ordered text history.
No old configuration or environment credentials are consulted.

Tool interface: `{name,description,parameters,execute(callId,args,signal)}`.
`parameters` is an object JSON Schema; unsupported validation keywords fail
registration instead of disappearing. Tool return values may be text or
`{content:[{type:'text',text}],isError?}`. Limits include rounds, callsPerRound,
resultBytes, timeoutMs (tool), turnTimeoutMs, maxOutputTokens, requestBytes,
responseBytes and frameBytes. The SDK owns the model/tool loop.

## Native history and explicit fallback

Default `historyMode: 'native-transcript'`: the initial SDK prompt contains a
random marker and bounded JSON reference (mode plus SHA-256 of the frozen full
transcript). The full messages stay in gateway memory, not in the SDK prompt.
Every model request must retain exactly one
unchanged user segment. The gateway replaces it with provider-native messages,
replaces coding instructions with compiled system messages, and retains only
assistant/tool continuations following the marker. Input budgets and traces
see this final expanded request. Missing/rewritten/duplicated markers and
unexpected additional context fail closed, including SDK history compaction.
Historical tool call IDs/results remain paired. `sourceRefs` remain in request
trace metadata. Source references are not injected as model instructions.

`historyMode: 'structured-transcript'` is an explicit alternative: the model
interprets the marked JSON text. It is not equivalent role replay. Both the
instructions and metadata distinguish the modes. There is no automatic switch.

Capabilities include `historyMode`, `nativeHistory`, `nativeHistoryAt:'gateway'`,
`structuredTranscript`, `deepSystem`, `budgetEnforcement:'gateway-every-request'`,
`budgetMeasurement`, `reasoning`, `realProviderVerified:false`. Per-turn
`executor.metadata` includes the applied OS security backend. `sdkRuntimeVerified`
is false until the real SDK integration is tested; no paid-provider verification
is claimed.

## Thinking controls and output budget

`connection.reasoning` is optional. Omission retains SDK defaults and is reported
as `sdk-default`. Explicit controls are applied to SDK options **and** the actual
outbound JSON on every request:

| Executor | Values | SDK / wire mapping |
|---|---|---|
| Claude | off | thinking disabled |
| Claude | adaptive | thinking adaptive |
| Claude | low, medium, high, xhigh, max | SDK effort + adaptive thinking; wire output_config.effort + thinking |
| Claude | `{thinking:{type:'enabled',budgetTokens:2048},effort?:'high'}` | SDK thinking; wire thinking.budget_tokens |
| Codex | minimal, low, medium, high, xhigh, max, ultra, persistent | SDK modelReasoningEffort; wire reasoning.effort |
| Codex | off | SDK effort omitted (no public off enum); gateway forces reasoning.effort=none |

Claude object form also supports adaptive/disabled and display summarized/omitted.
Unknown fields/levels and contradictory combinations are rejected. Public SDK
levels are interface support, **not a promise that the selected model accepts
that level**. In particular Codex ultra/persistent are present in the pinned SDK
but not guaranteed by the general Responses model guide. Upstream rejection
fails the turn; there is no silent fallback or automatic retry.

The gateway clamps actual `max_tokens` / `max_output_tokens` to the configured
per-turn cap (and preserves a smaller SDK cap). Claude fixed thinking budget
must be >=1024 and strictly below that actual cap; otherwise nothing is sent.
Thinking and visible output share that total output allowance. Reaching that cap
is a completed, length-truncated reply for both protocols: Anthropic
`stop_reason: max_tokens`, and a Responses `response.incomplete` whose reason is
`max_output_tokens`, which the gateway relays to the SDK as `response.completed`
because the SDK would otherwise treat it as a retryable stream error. Other
incomplete reasons (such as `content_filter`) still fail the turn. Input accounting
uses JSON UTF-8 byte length + 1024 as a conservative estimate, **not exact provider
tokenization**. Inject `countTokens(request)` into the factory when a verified
provider-aware counter is available. Real raw usage is retained per request;
missing usage remains incomplete and cost is null. `beforeRequest` and `onRequest`
are awaited before dispatch. `onRequest` receives redacted actual JSON, without
credentials or gateway token. No automatic model retry is enabled.

## Normalized usage for conversation totals

Both `result.usage` (aggregate) and `result.usage.requests[n]` expose
`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`,
`reasoningTokens`, `totalTokens`, plus `cost:null`. Unknown counts are null,
never implicit zero. A field's aggregate is null if any contributing request
lacks that field. No requests also means null, not a measured zero.

All normalized counts use `inputTokensIncludesCache:true` and
`outputTokensIncludesReasoning:true`. Do **not** add cache/reasoning breakdowns
to totalTokens. Claude inputTokens = raw input_tokens + cache_read_input_tokens
+ cache_creation_input_tokens; if any operand is unknown the inclusive input
and derived total remain null. Responses input_tokens already includes cache;
its reported total_tokens is preserved, or input+output is derived when both
are known. Per-request `rawInputTokensIncludesCache` is false for Claude and
true for Responses; `rawUsage` preserves merged provider counters.

Claude reasoningTokens comes from output_tokens_details.thinking_tokens;
Responses uses output_tokens_details.reasoning_tokens. Cache writes use
Claude cache_creation_input_tokens or Responses input_tokens_details.cache_write_tokens.
An absent thinking/cache breakdown remains null even if reasoning is disabled
or the response contains no visible thinking. No tokenizer estimates enter usage.

Aggregate `complete` means every request completed and has known inclusive
input/output/total; `breakdownComplete` additionally requires all six counts.
Per-request `complete` retains its existing model-response completion meaning;
`usageComplete` separately describes availability of the main usage counts.
`usage.updated` emits the current request's six fields and `rawUsage`, with the
full aggregate snapshot under `event.usage` for runtime persistence. It is a
cumulative snapshot: replace stored usage rather than adding repeated events.
Streaming usage reports overwrite cumulative counters instead of summing them;
null delta fields do not erase previously reported counts.

The inclusive convention is explicit to allow the parent to reconcile other
executors' conventions before combining them. Do not assume the separate PI
executor's input/cache fields follow this convention without checking its adapter.
Protocol evidence: installed Anthropic SDK `Usage`/`OutputTokensDetails` and
[official Responses usage definitions](https://github.com/openai/openai-node/blob/main/src/resources/responses/responses.ts).

## Isolation, cancellation and ownership

Each run owns a random-token localhost HTTP gateway, isolated temp HOME,
CODEX_HOME/CLAUDE_CONFIG_DIR, SDK child and AbortController. The environment is
an allowlist; inherited auth/proxy/config variables are not copied. Real upstream
credentials stay in the parent gateway; children receive only its per-run token.
Claude exposes no builtin tools and only the domain MCP server. Codex disables
shell/unified_exec, apply_patch, web search, browser/computer tools, hooks, memory,
extra agents and request compression in config. Gateway additionally removes
non-domain tool declarations and refuses builtin tool outputs before SDK delivery.
MCP execution requires a matching unused model-issued tool permit and validates
arguments. After execution starts, timeout/failure yields unknown external effect;
no replay is allowed.

On Darwin, `environment.js` writes a concrete deny-default sandbox-exec policy.
Only the selected native executable may execute. Read access is limited to its
binary, system runtime paths, root directory itself (not its descendants), random
devices and the task directory. Writes are task-local. TCP outbound is only to
the selected localhost gateway port; no credential IPC entitlement is granted.
Codex's read-only mode is an additional restriction, not the isolation claim.
The trusted generated launcher is outside the sandbox and only starts/joins the
sandboxed native CLI; it does not evaluate SDK arguments. Other platforms require
an injected restricted environment backend and fail without one.

All exits attempt SDK close, child exit confirmation, temp environment close and
gateway socket close in `finally`. Unconfirmed child exit retains its temp data
and reports sdk-shutdown-incomplete. This is deliberately a failure, not successful
cleanup. Provider abort does not prove an external side effect was undone.

## Verified evidence and remaining integration work

Pinned dependencies (installed centrally; this module does not modify locks):

| Package | Version | npm publication UTC |
|---|---|---|
| @anthropic-ai/claude-agent-sdk | 0.3.289 | 2026-10-03 20:12:59.628 |
| @openai/codex-sdk | 0.156.1 | 2026-09-23T02:45:50.362Z (parent npm verification; exceeds 7 days) |

Both exceed seven days of release age on 2026-10-11. Runtime verifies the exact
package versions and requires the platform-native optional packages. Public
installed sources: `@anthropic-ai/claude-agent-sdk/sdk.d.ts` Options, EffortLevel,
ThinkingConfig; `@openai/codex-sdk/dist/index.d.ts` CodexOptions, ThreadOptions,
ModelReasoningEffort. Codex configuration keys checked against the pinned
[official config schema](https://github.com/openai/codex/blob/rust-v0.156.1/codex-rs/core/config.schema.json).
Protocol controls: [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking),
[Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort),
[Responses reasoning](https://developers.openai.com/api/docs/guides/reasoning).

`node --test tests/conversation/modules/sdk/*.test.mjs`: **37 passed**, exit 0 on
Darwin arm64 Node 26.10.0. Tests use fake SDK/fetch and gateway.handle(Request);
no HTTP server or paid model is started. OS unit tests actually run generated
sandbox policies: allowed task file succeeds, outside generated canary read
fails, another executable fails, outside write fails. This does not prove the
real SDK runtime's startup/network needs are all satisfied.

Installed SDK integration is now exercised against a local fake provider; see
the evidence below. Live provider behavior remains a separate verification
owned by the parent. No paid service was called by this SDK integration suite.

Concrete hard refusals (not silently degraded): Claude native deep system roles
(Messages only has a top-level system field); media blocks without a verified
encoder; unpaired historical tools; unsigned/unsupported thinking replay; SDK
history rewriting; unsupported sampling parameters/schema constraints; unverified
OS platforms. For deep system, use a native Responses executor or explicitly
choose structured-transcript; flattening would change semantics. These boundaries
remain visible integration work rather than a claim of full provider parity.

## Installed SDK integration evidence (2026-10-11, macOS arm64)

`node --test tests/conversation/integration/installed-sdk.test.mjs` exits 0:
22/22 pass. `node --test tests/conversation/modules/sdk/*.test.mjs` exits 0:
49/49 pass. No skips in either run.
Both Claude 0.3.289 and Codex 0.156.1 pass six actual SDK scenarios:
text/native history, MCP domain-tool round trip, initial budget rejection,
budget rejection after a tool result, in-flight abort, and rejection of a
model-issued host tool. OS checks confirm no preference/IPC allow rules and
TCP access only to the selected gateway port. Every SDK turn asserts gateway
connection refusal and removal of the isolated runtime directory after cleanup.
Unit OS tests additionally verify denied outside-file reads/writes and executable
launches. The parent MDM test checks fail-closed behavior and boolean-only output.
These tests use local fake HTTP, not saved credentials or paid models; they do
not establish provider-specific support, accuracy of provider token limits, or
protection against OS/runtime vulnerabilities.

### Historical failure before the approved version change

Codex 0.160.0 loads after resolving its import-only package and `vendor/.../bin/codex`
layout, but all six actual SDK cases fail before upstream model dispatch. The
native error observed during local diagnostic execution is:
`thread/start failed: failed to load configuration: Failed to synchronize managed preferences`.
The pinned upstream `codex-rs/config/src/loader/macos.rs` invokes
`CFPreferencesAppSynchronize("com.openai.codex")` and fails when it returns zero.
No host preference read/write or cfprefsd IPC allowance remains in our profile;
broadening those permissions is not an acceptable way to pass this test.
Any `/etc/codex` installation is rejected before process launch rather than
silently replacing host administrator configuration. A missing directory is
kept inaccessible to the child with ENOENT semantics.

Known fixes from actual execution: ESM-only package resolution, native binary
layout, exact ancestor metadata permission for canonicalization, OS ICU/locale
read access for Bun Intl, Claude-owned temp directory variables, and removal of
separate SDK reminder blocks preceding the exact unmodified transcript fragment.
A missing, modified, repeated or non-final fragment still fails closed. Cancellation
after upstream dispatch now reports `aborted` with `outcome: unknown`, not a
misclassified transport failure. Temporary diagnostic logging was removed.


### Codex compatibility target 0.156.1

The pinned compatibility target is now 0.156.1; the failed 0.160.0 run above is
historical evidence, not the result for the replacement. The official 0.156.1
`macos.rs` still checks forced MDM keys before copying a value, but has no
`CFPreferencesAppSynchronize` call. SDK `CodexOptions`, `ThreadOptions`, signal
cancellation and `exec --experimental-json` are source-compatible with our use.
Actual replacement integration now passes the scenarios documented above.

Before starting Codex, the trusted parent runs a fixed `/usr/bin/osascript`
JavaScript/ObjC program. It calls `CFPreferencesAppSynchronize` for
`com.openai.codex`, then `CFPreferencesAppValueIsForced` for
`config_toml_base64` and `requirements_toml_base64`. Only three booleans leave
that process. No preference value getter or setter is called. Refresh failure,
invalid output, timeout, process failure, or either forced key rejects startup.
The child continues to have no user-preference or cfprefsd IPC permission.
This is a startup presence check, not support for managed hosts or continuous
monitoring of administrator policy changes during a turn.

### Domain tool authorization and local token lifecycle

Codex uses the official 0.156.1 `bearer_token_env_var` configuration with the
fixed name `CONVERSATION_MCP_TOKEN`. Only the isolated child environment carries
the ephemeral value; no MCP header value is passed through SDK config/CLI
arguments or a separate config file. The installed tests assert this separation.
The SDK API key is likewise passed by the SDK through its child environment.
Diagnostics must never inspect or print process arguments or environments.

Each registered domain tool has explicit `approval_mode: 'approve'` in
`mcp_servers.domain.tools`; this is limited to the caller-authorized domain
registry. It does not enable shell, file, networking tools or change OS policy.
Actual Responses tool calls use `namespace: 'mcp__domain', name: '<tool>'`
matching the SDK's declared namespace. Gateway permits still require an exact
model-issued name/arguments pair and are consumed once before execution.
Claude can emit a warning that allowedTools shadows canUseTool; enforcement
does not rely on that callback, but on the gateway permit and OS restrictions.

Every run owns a random gateway token and local listener. Finally aborts the SDK,
joins its subprocess, closes active gateway sockets and removes runtime files.
Tests confirm the listener refuses connections after both success and failure;
the old local token has no remaining active gateway through which to authorize
a request. The token is never an upstream provider credential.

### Non-Claude model environment suffix

The real Claude SDK emits a separate system-role environment block after the
marker when using `deepseek-v4-flash`. Both SDKs now have local integration
coverage using the live script's two-message content, empty tools, and rounds=1.
The gateway removes only one immediately adjacent block whose text exactly
matches the trusted environment factory's current isolated directory, model,
Darwin release and date. Extra keys, changed text, duplicate or displaced blocks
remain `unexpected-sdk-context` failures. No environment description is sent
upstream. A future SDK template change (or date rollover during startup) fails
closed and needs explicit compatibility validation.

### Fatal unknown tool results and explicit proxy refusal

The tool wrapper must throw a terminal error or return structured unknown state:
`error.code: 'tool-result-unknown'`, `details.outcome: 'unknown'`,
`outcome/status: 'unknown'`, or `tool-persistence-failed`.
For MCP error wrappers, `isError: true` plus a text block containing the JSON
error object is also recognized. Free-form error prose is not parsed for intent.
Unknown outcomes stop the gateway immediately, abort the SDK and retain
`error.details.outcome`, `toolCallId` and `toolStates` with state `unknown`.
No completed result is emitted, further requests are blocked, and a consumed
tool permit cannot be replayed. Definitive ordinary tool error results remain
available to the model. Both actual SDKs have local unknown-result tests proving
one model request, one execution and closed resources.

Canonical `connection.proxy: {url}` uses shared HTTP/HTTPS validation.
Without injected fetch, the SDK runtime owns a createConnectionFetch transport
for the turn and closes it in finally on success/failure, including startup
failure. This also avoids inherited environment proxy settings on direct calls.
An injected fetch is a caller-owned, already connection-aware transport contract:
composition supplies createConnectionFetch(connection).fetch and closes it at
server shutdown. The SDK neither double-wraps nor closes that injected transport.
Native global fetch is explicitly rejected when a proxy is configured because it
cannot honor the Node proxy agent. Legacy proxyUrl/proxy_url/httpProxy/httpsProxy/
socksProxy fields remain unsupported-proxy errors.

Actual Claude/Codex installed tests use a separate authenticated local HTTP
proxy forwarding only to an independently listening local model peer, with an
unresolvable upstream .invalid hostname. They assert proxy authentication and the
absolute request target, no proxy credentials at the model peer, and no credential
leakage in gateway traces/events/results. These use the runtime-owned default
transport, without injected fetch. HTTPS/TLS proxy behavior belongs to the shared transport test suite;
it is not independently verified by these SDK tests. SDK sandbox networking
continues to allow only its local gateway, not direct access to the proxy.

### Shared cost normalization

Per-request usage, usage.updated events and aggregate result.usage now expose
costUsd, costSource and costEstimated through providers/core/cost.js, matching
PI. Documented OpenRouter usage.cost is provider-reported USD; explicitly
normalized costUsd is preserved. Explicit SDK estimates remain sdk-estimated,
never provider charges. Mixed actual/estimated requests report mixed source and
costEstimated=true. A missing cost in any request makes the aggregate cost null;
known per-request costs and rawUsage are retained. Explicit zero remains zero.
No pricing table is inferred, and aggregate SDK session estimates are not
distributed across gateway requests. Token completeness is independent of cost
availability. Latest cost-change SDK unit suite: 45/45, exit 0; no live rerun.
Canonical connection.proxy is now wired through the shared transport; unsupported
legacy proxy fields remain rejected independently.

### Full-history Claude startup regression

Installed Claude 0.3.289 rejected the previous 1,105,610-byte SDK prompt locally
with assistant error invalid_request / "Prompt is too long", then emitted
success subtype with is_error=true; no provider fetch happened. Native mode now
uses a bounded marker reference before gateway expansion. Structured-transcript
mode still sends full text; it is not silently changed into native replay.

The installed offline regression uses the full synthetic evaluation dataset,
config.deepseek.example.json, 50 questions and preserveFullHistory=true through
adapter factory injection. It supplied only a synthetic key via explicit env,
not host credentials. Observed: SDK prompt 289 bytes, Anthropic outbound JSON
806,602 bytes / 3,041 messages, exactly one dummy fetch which deliberately throws.
Outbound messages and system are deep-equal to the complete compiled request.
The request's actual expanded body remains subject to the gateway budget; a
separate unit regression proves a small budget still blocks dispatch.
No real provider call or live evaluation was performed for this fix.

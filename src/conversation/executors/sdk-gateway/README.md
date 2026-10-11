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
random marker and JSON transcript. Every model request must retain exactly one
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
Thinking and visible output share that total output allowance. Input accounting
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
| @openai/codex-sdk | 0.160.0 | 2026-10-01 20:25:41.854 |

Both exceed seven days of release age on 2026-10-11. Runtime verifies the exact
package versions and requires the platform-native optional packages. Public
installed sources: `@anthropic-ai/claude-agent-sdk/sdk.d.ts` Options, EffortLevel,
ThinkingConfig; `@openai/codex-sdk/dist/index.d.ts` CodexOptions, ThreadOptions,
ModelReasoningEffort. Codex configuration keys checked against the pinned
[official config schema](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/config.schema.json).
Protocol controls: [Claude thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking),
[Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort),
[Responses reasoning](https://developers.openai.com/api/docs/guides/reasoning).

`node --test tests/conversation/modules/sdk/*.test.mjs`: **37 passed**, exit 0 on
Darwin arm64 Node 26.10.0. Tests use fake SDK/fetch and gateway.handle(Request);
no HTTP server or paid model is started. OS unit tests actually run generated
sandbox policies: allowed task file succeeds, outside generated canary read
fails, another executable fails, outside write fails. This does not prove the
real SDK runtime's startup/network needs are all satisfied.

Remaining final integration: real pinned SDK + local fake provider, exercising
startup, marker preservation, tool loop, stop, outbound network restriction and
resource shutdown. No real SDK runtime or paid service has been run in this
unit-test phase. Native availability must not be inferred from fake-SDK success.

Concrete hard refusals (not silently degraded): Claude native deep system roles
(Messages only has a top-level system field); media blocks without a verified
encoder; unpaired historical tools; unsigned/unsupported thinking replay; SDK
history rewriting; unsupported sampling parameters/schema constraints; unverified
OS platforms. For deep system, use a native Responses executor or explicitly
choose structured-transcript; flattening would change semantics. These boundaries
remain visible integration work rather than a claim of full provider parity.

# SDK executors: current contract

Factories are `createClaudeExecutor({fetch,onRequest,countTokens})` and
`createCodexExecutor({fetch,onRequest,countTokens})`. The locked versions are
Claude Agent SDK 0.3.289 and Codex SDK 0.156.1; `loadSdk` rejects other versions.
Both expose synchronous `preflight({connection,requestPlan?,limits?})`,
`getCapabilities(connection)` and `runTurn`:

```js
await executor.runTurn({
    snapshot, requestPlan, connection, tools: [], limits, signal,
    beforeRequest: async actualContext => {},
    onEvent: async event => {},
});
// {content, reasoning, usage, finishReason, toolStates, capabilities}
```

`requestPlan.messages` is the complete ordered compiled history. Connection is a flat data object, as passed by composition. Resource `.data`
wrappers are rejected. Required
fields are model, baseUrl, contextWindow, workingBudget and maxOutputTokens;
optional fields include inputLimit/outputLimit, apiKey/headers, reasoning and
canonical `proxy: {url}`. Media token costs belong in `capabilities.mediaTokenCost`;
the SDK still only supports text history. Unknown sampling parameters are rejected.

## Explicit history modes

`historyMode: 'native-transcript'` is the default. Its metadata exposes
`nativeHistory:true`, `nativeHistoryAt:'gateway'` and that mode name.
The product also offers explicit `structured-transcript`: ordered roles and source
references remain JSON interpreted by the model, with `nativeHistory:false` and
`structuredTranscript:true`. It is not lossless native replay or an automatic
fallback. Both modes require the exact marked input; unknown modes fail.

The SDK receives a short random marker plus a JSON reference containing the
SHA-256 of the complete frozen transcript. Full history stays in gateway memory.
Before every actual model request, the gateway requires exactly one unmodified
marker, expands it to provider-native history, replaces SDK coding instructions
with the compiled system, and retains current-turn assistant/tool continuations.
The fully expanded request is what budget counting and request traces inspect.
Missing, changed or duplicate markers and unexpected context are fatal.
Source references remain in trace metadata; original source labels in compiled
content are preserved. There is no SDK-side history truncation or compaction.

Claude Messages uses top-level system plus user/assistant content blocks.
Codex Responses supports system/user/assistant and function-call/output items.
Tool IDs and results must be paired. Deep system messages unsupported by Claude,
media without verified encoders and unsupported signed-thinking replay are
explicit errors. These protocol constraints are not silently flattened.

The current Claude SDK prepends reminder blocks and, for non-Claude model IDs,
may append its environment description as a system message. The gateway removes
only the validated reminder structure and the exact trusted environment block
for this isolated directory/model/OS/date. Modified, duplicated or displaced
suffixes fail. These are required current SDK adaptations, not older-version
fallbacks. The environment description never goes upstream.

## Tool loop and isolation

Domain tools are `{name,description,parameters,execute(callId,args,signal)}`.
Limits include rounds, callsPerRound, resultBytes, timeoutMs (tool),
turnTimeoutMs, maxOutputTokens, requestBytes, responseBytes and frameBytes.
The schema validator accepts a bounded explicit subset and rejects unknown
keywords. Model-issued tool calls create one-use permits bound to name,
arguments and call ID. MCP can execute only a matching unused permit. Claude's
`tools:[]`, domain `allowedTools`, strict MCP config and `dontAsk` permissions
restrict its loop. No shadowed canUseTool callback is installed. Codex disables
host tools and explicitly approves only the supplied domain tool names.
Anthropic flat MCP names and Responses namespaces are both necessary current
wire formats; they are not interchangeable application configuration aliases.

Unknown side effects terminate the gateway and SDK. Accepted terminal signals
include thrown errors, `error.code:'tool-result-unknown'`,
`details.outcome:'unknown'` and `tool-persistence-failed`; MCP JSON error blocks
with `isError:true` are recognized too. The failure retains outcome, toolCallId
and toolStates. Definitive ordinary tool-error results may return to the model.
Unknown effects are never retried or marked completed.

macOS uses a generated default-deny sandbox: SDK executable only, isolated
runtime files, required system runtime libraries and the one local gateway TCP
port. No host user-file access, preference permission or cfprefsd IPC is granted.
Other platforms require an explicitly enforced environmentFactory. Before Codex
starts, the trusted parent checks presence of the two forced managed-policy
keys using built-in osascript. It reads no values, calls no preference setter,
and refuses managed or indeterminate environments. `/etc/codex` presence also
refuses startup. The check is at startup, not continuous policy monitoring.

Codex MCP authentication uses `bearer_token_env_var: CONVERSATION_MCP_TOKEN`;
its value is in the isolated child environment, never configuration argv.
Do not inspect/log process arguments or environments. Each run owns and finally
closes its SDK process, isolated directory and gateway. Incomplete shutdown is
reported without replacing an earlier execution failure.

## Transport, budget and cancellation

Claude baseUrl is the API origin or ends in `/v1`; Codex baseUrl is the Responses
API base. The gateway speaks these protocols directly, without cross-provider
conversion. Every actual request receives the configured output ceiling and a
budget check after native history expansion. The default counter conservatively
uses serialized UTF-8 bytes plus overhead; an injected counter is labeled as
such. Output controls sent to providers do not prove provider compliance.

Default parent-side transport is `createConnectionFetch(connection)`, owned and
closed by this turn. It honors HTTP/HTTPS proxy configuration and does not inherit
environment proxies. An injected fetch is a caller-owned, already
connection-aware transport; composition closes its transports on server close.
Native global fetch with a proxy is rejected. Alternate proxy fields are rejected,
not converted. SDK child networking remains restricted to the local gateway.

Buffered stream framing yields to the event loop after 32 frames or about 8 ms
of processing, then checks cancellation. This permits deadline timers to run
between batches; it cannot interrupt a synchronous persistence callback already
executing. Stream cancellation reports `aborted` with unknown external outcome.
Iterator cancellation and process cleanup still depend on their underlying
resources completing; this is not an independent hard wall-clock kill deadline.

## Reasoning and usage

Public reasoning levels map through reasoningControls to SDK options and actual
wire JSON. Application `reasoning` is a string only; object forms and top-level
`effort` are rejected. SDK/wire `effort` fields are required protocol encoding,
not configuration aliases. Omitted reasoning preserves SDK defaults. Claude SDK
default thinking budgets must fit the current output ceiling. Model/provider acceptance is separate from
interface support; DeepSeek does not enforce Anthropic thinking budgets.

Each usage request and aggregate reports inclusive inputTokens/outputTokens,
cacheReadTokens/cacheWriteTokens/reasoningTokens/totalTokens and rawUsage.
Cache is included in input and thinking in output. Unknown counters remain null;
complete requires terminal response and known input/output/total. Shared
normalizeCost/aggregateCost supply costUsd/costSource/costEstimated. Actual and
explicitly estimated fees remain distinguishable; missing request cost makes the
aggregate cost unknown. No session estimate is distributed across requests.

## Verification boundary

Offline unit tests cover encoding, budgets, current SDK configuration, one-use
tool permits, unknown outcomes, proxy contract, usage and buffered-stream abort.
Fake SDK tests do not prove real subprocess or provider behavior. Installed SDK
integration tests are a separate opt-in layer; no real SDK, long-history, paid or
limit tests are part of the current cleanup verification. PI remains a separate
executor and is not modified by this SDK cleanup.

## Cleanup decisions and product evidence

Structured mode is retained because the current connection editor offers it in
`public/modern/conversation/resources/view.js`, and `resources/model.js` labels
its non-native semantics. `tests/conversation/modules/client/resources-media.test.mjs`
checks both labels; SDK gateway unit tests check both protocol encodings.
AGENT-PLAN.md sections 1/3 require all executors and explicit capability contracts;
CONTRACTS.md's compiler/executor contracts retain ordered messages and source refs.
Neither document explicitly names structured-transcript: the concrete product
selector and implementation, not an inferred plan requirement, justify retaining it.
Native failures never switch modes automatically.

Removed configuration inputs are the resource `.data` wrapper, top-level effort /
mediaTokenCost and object reasoning; shared `connectionShapeError` defines their
canonical replacements (flat connection, string reasoning, capabilities costs).
SDK protocol effort fields remain. Deprecated Codex feature aliases connectors,
memory_tool and codex_hooks duplicated apps, memories and hooks, which remain
disabled. Claude's shadowed canUseTool callback is removed; tools:[], domain
allowedTools, strict MCP, permissions, one-use gateway permits and OS isolation
remain enforced. The unreferenced createMcpHandler export is removed; all current
MCP callers use createMcpServer, retaining its direct and HTTP interfaces.

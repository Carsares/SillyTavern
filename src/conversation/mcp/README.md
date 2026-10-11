# Restricted MCP gateway API

`createMcpServer({registry, store, now=Date.now, ttlMs=120000})` is exported from
`index.js`. The factory opens no port, starts no process, reads no host
files, and enables no SDK host tools.

Returned API:

- `handler(req,res)`: Node HTTP/Express-compatible POST JSON handler. Composition
  mounts this at its chosen URL on a random loopback port. POST requires
  `Content-Type: application/json` and `Authorization: Bearer <token>`. Bodies are
  limited to 64 KiB. Browser Origin requests, batches and non-POST requests are
  rejected. Do not expose this listener on an external interface.
- `issueToken(turnId, {tools?,memberRunId?}={}) -> string`: opaque token, scoped to
  active turn/attempt and an optional subset of enabled registry tool names.
  Lifetime defaults to 120 seconds, at most `TOOL_LIMITS.turnTimeoutMs`.
- `revokeToken(token) -> boolean`; `close()` revokes all tokens.
- `handle({token,message,signal?}) -> Promise<{status,body}>`: direct JSON-RPC
  entry for adapter tests without a listener. `body` is null for initialized
  notification acceptance.

Supported methods: `initialize` (protocol 2024-11-05),
`notifications/initialized`, `ping`, `tools/list`, `tools/call`. Tool listing maps
registry `parameters` to MCP `inputSchema`; execution calls that same registry.
No resources, prompts, filesystem, shell, network or host execution endpoints.
Tokens and current turn status are checked per HTTP/JSON-RPC request, and again
before releasing asynchronous tool results. Tool errors have MCP `isError:true`.

Tool-call dedupe uses token session + typed JSON-RPC ID. Retry the same logical
request with the same token and ID. Never retry uncertain image work with a new
ID or newly issued token. Tokens are deliberately not persisted. Composition
must revoke tokens and close its listener at turn completion, and SDK adapters
must explicitly disable SDK-native host tools.

Registry orchestration is shared with direct SDK execution:
`bindTurn({turnId,snapshot,requestPlan})` binds the accepted immutable snapshot and
already-included worldbook blocks; `beginRound({turnId,conversationId,round})`
advances the trusted model-call counter (1..5). Neither operation is exposed to
model-controlled MCP arguments. Collect `registry.memoryProposals(turnId)` for
MCP calls and pass to `store.finishTurn` only on completed turns, then call
`registry.release(turnId)`. Host-side adapters must account for rounds; this
transport deliberately implements no model/tool loop.

Unit evidence lives in `tests/conversation/modules/mcp/mcp.test.mjs`. Real
Claude/Codex transport compatibility, listener lifecycle and SDK host-tool
isolation remain composition/adapter integration checks, not claims of these
unit tests.

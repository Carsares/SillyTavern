# Provider adapters and Pi bridge

All implementation here is new protocol code. No legacy state, settings, endpoint
handlers or model loops are imported. `providers/core` is consumed read-only.
**Every remote platform/model is live-unverified.** Synthetic fetch/stream tests
verify serialization and decoding, not account access, model support or pricing.
The complete identifier/wire mapping is in `../../capabilities/chat/README.md`,
`../../capabilities/text/README.md`, and `../../capabilities/auxiliary/README.md`.

## Exact API

```js
import { createProviderAdapter } from './index.js';
const adapter = createProviderAdapter(connection, {
    fetch,       // receives a Request; injectable, defaults to globalThis.fetch
    onRequest,   // async, before network, receives redacted serialized request
    onPayload,   // optional internal Pi validation hook, before network
    store,       // accepted but unused; adapters never persist or run tools
});
await adapter.generate({
    messages, prompt, tools: [], signal, maxOutputTokens, onEvent, stream,
}); // -> {content,reasoning,toolCalls,usage,finishReason,rawFinishReason?,providerContent?}
await adapter.embed(texts, {signal,inputType?,dimensions?});
// -> {embeddings:number[][],model,usage}
await adapter.generateImage({prompt,negativePrompt?,width?,height?,count?,seed?,steps?,signal,onEvent?});
// -> {images:[{url}|{data,mimeType}],usage,jobId?}
```

The unified factory dispatches by `connection.type`: `chat` (default), `text`, or
`embedding|image|auxiliary`. Generation adapters expose `generate`; auxiliary
adapters expose `embed` and `generateImage` and reject unsupported operations.
`connection` may also be a Resource with `.data`. It is cloned at construction.
There is no fallback from one provider to another.

Generation events: `text.delta`/`reasoning.delta` carry `text`; `tool.delta` carries
`{text,index,id,name}`; completed `tool.call` carries `{id,name,args}`; `usage`
carries `usage`. Callbacks may be async and are awaited. `finishReason` is
`stop|length|toolUse`; native reason and signed content are separately retained.
No adapter executes a tool. Chat defaults to SSE, `stream:false` requests JSON.
Each operation checks cancellation, transport timeout defaults to 120 seconds,
and no HTTP failure is retried. An HTTP error after submission can have an unknown
remote outcome. Never blindly replay paid generation.

Usage is `{inputTokens,outputTokens,totalTokens,source:'provider',cost:null,...}`.
Missing provider fields remain null, never estimated or called free. The Pi bridge
uses NaN for unavailable numeric counts/prices because Pi's fields are numbers;
its raw usage hook preserves nulls. Integrators must preserve unknown semantics
when summing or serializing usage. No cost model is invented.

## Native chat protocol distinctions

OpenAI-compatible/AI21 Jamba use chat-completion envelopes; AI21 has a separate
capability profile limited to documented text parameters. Anthropic uses
`/messages`, `x-api-key`, `anthropic-version`, system content, tool_use/tool_result
and signed thinking blocks. Google uses `generateContent` or
`streamGenerateContent?alt=sse`, systemInstruction, contents/parts and native
function calls/responses. Vertex uses the same content protocol with bearer OAuth
access token; base URL must include project/location/publishers/google. No ambient
ADC or credential refresh occurs. Cohere uses `/v2/chat`, native thinking/content
events and `p/k/stop_sequences`. Azure uses a deployment path, `api-key`, and an
explicit `apiVersion`. Workers AI requires an explicit account-scoped compatible
base URL. Local/custom providers require explicit base URLs; catalog defaults are
convenience endpoints only and do not prove a live service supports the model.

Base URLs must have no credentials/query/fragment. Custom headers cannot override
adapter-managed auth, Host or Content-Length. Trace headers are allowlisted by
the core helper, secret values are redacted, and raw upstream errors are not echoed.
Sampling is allowlisted by profile; it cannot overwrite messages, model, auth,
tools, output budget or endpoint. See `parameters` on each capability.

Anthropic/Google reject mid-history system instructions rather than silently
moving them. The compiler/runtime must select a compatible layout. Typed images
require an explicit positive `connection.mediaTokenCost.image` (or
`connection.capabilities.mediaTokenCost.image`). Google requires inline base64;
OpenAI/Anthropic also accept HTTP image URLs. Audio/video/document parts are
explicitly unsupported, not discarded. Model-specific media support still requires
verification. Image costs are supplied to the external budget checker.

## Reasoning controls and SSE

`connection.reasoning` selects the native control, not a model-name heuristic:

| API | Values | Serialized field |
| --- | --- | --- |
| Anthropic | off, budget, adaptive | thinking.type; budget_tokens for budget |
| Google/Vertex | off, budget, low, medium, high | generationConfig.thinkingConfig |
| Cohere | off, budget, on | thinking.type and token_budget |
| Compatible/Azure | minimal, low, medium, high | reasoning_effort |
| AI21 | absent/off | no invented reasoning control |

`reasoningBudget` must be a positive integer below output reserve (Anthropic at
least 1024). Google returns thought summaries via includeThoughts; these are not
claimed to be raw internal reasoning. Compatible `off` means no override, which
does not disable a reasoning-only model. Some compatible platforms/models reject
effort controls; validate the selected model before exposing them. Protocol support
does not set `liveVerified` or `verified` automatically.

SSE parses chunked UTF-8, CRLF, multiline data, comments, and terminal events.
Text, thinking, signatures and tool JSON are accumulated separately. Anthropic
`thinking_delta/signature_delta`, Google thought parts, Cohere thinking blocks,
and compatible `reasoning_content/reasoning` deltas are emitted as reasoning.
Incomplete/error streams throw; content-blocked finishes never become success.
Completed tool arguments must be JSON objects. Signed provider content survives
the Pi round trip without reinterpreting it as user instructions.

## Main-thread composition (not executed by this package)

```js
import { createPiExecutor } from '../../executors/pi/index.js';
import {
    createProviderStream, createProviderModel, providerCapabilities,
} from './bridge.js';

const profile = providerCapabilities(connection);
const effectiveConnection = {...connection, baseUrl: profile.baseUrl};
const executor = createPiExecutor({
    capabilityResolver: providerCapabilities,
    modelFactory: createProviderModel,
    streamFn: createProviderStream(effectiveConnection, {
        // Required only for text mode. Use the chosen new preset's renderer;
        // do not serialize arbitrary roles using a hidden fallback template.
        renderPrompt: ({messages}, nativeContext) => renderChosenTextTemplate(messages),
    }),
    fetch: injectedFetch,
    onRequest: persistRedactedTrace,
});
await executor.runTurn({...runInput, connection: effectiveConnection});
```

Pi passes its checked/captured fetch, onPayload, signal, maxTokens and raw usage
hook through the bridge. A stream call makes exactly one adapter.generate call;
the Pi Agent owns all iteration, tool execution and next-call budget checks.
`fromPiContext` translates native SystemMessage/toolsAdded/toolsRemoved and
toolResult identities. Empty tools-only system messages are not injected as text.
Mid-history named section replacement is rejected explicitly. `providerContent`
retains Google signed parts across rounds. Anthropic native thinkingSignature and
redacted thinking are reconstructed without modifying signatures.

Core capability validation is owned by the Pi agent. This package propagates only
the caller's `connection.capabilities.{verified,reasoningEnabled,reasoningEfforts}`;
it never invents verification. For a verified native budget mode, set e.g.
`reasoning:'budget', reasoningBudget:2048, effort:'medium'` and the externally
verified finite effort list. `effort` is Pi's scheduling level; `reasoning` is the
native wire mode. Image support likewise requires a verified explicit budget in
core. Connections without these features use text and no reasoning override.

## Evidence and limitations

Tests: `node --test tests/conversation/modules/providers/*.test.mjs`.
All fake fetch; no server, database, real provider, SDK loop integration or payment.
All remote platforms, models, API account entitlements, context limits and prices
remain unverified. Connection model IDs and budgets are explicit inputs.

Primary protocol references read during implementation:
- https://platform.claude.com/docs/en/api/messages/create
- https://platform.claude.com/docs/en/build-with-claude/streaming
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/generate-content/thinking
- https://docs.cohere.com/reference/chat-stream
- https://docs.cohere.com/docs/reasoning
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/

AI21 documentation and the NovelAI/Kobold Swagger endpoints were unavailable to
the documentation reader during this run. Their wire fixtures require live
verification; no documentation-read failure is represented as a successful check.

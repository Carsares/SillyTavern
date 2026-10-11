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
`reasoning:'budget', reasoningBudget:2048` and the externally
verified finite effort list. `reasoning` is the native wire mode; PI handles scheduling without a second effort field. Image support likewise requires a verified explicit budget in
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

## Extended media input and composition contract

`generate({messages})` accepts content blocks `{type:'image'|'audio'|'video'|'document',
mimeType, data?:base64, url?:string, filename?:string}`. Exactly one byte/URL source
is accepted. Google/Vertex use `inlineData`/`fileData` (HTTP or gs URI); Anthropic
uses PDF document/image sources; OpenAI, explicit compatible profiles and OpenRouter
use inline WAV/MP3 `input_audio` and inline PDF `file`. Other compatible profiles do
not claim these extra modalities. MIME must match the block type. No file download,
implicit transcription or text extraction is performed. Unsupported combinations
fail before fetch. Live model support is unverified; explicit positive
`mediaTokenCost` for every selected modality is mandatory.

Pi 1.0.2 extension for Linnaeus/executor/composition owners:

- A user/tool message may carry `providerParts`, the **entire ordered content array**,
  including text and media. It replaces, rather than appends to, Pi `content` on
  provider conversion. Preserve this field through history and context conversion;
  budget the same full array on every call. Direct typed `content` also works.
- `createProviderModel` keeps Pi `input` limited to text/image, and adds
  `providerMedia` with the effective full media list. Capability checks must consult
  provider capabilities rather than infer media support from Pi's narrower type.
- Final Pi assistant messages carry `providerUsage` with normalized counts plus
  `raw`. `onProviderStreamEvent({usage})` exposes the same complete normalized/raw
  object before completion. Do not re-add cache/reasoning subsets to total counts.
- Image/audio text-provider side channels also need their explicit budget. Guidance
  `negative_prompt` is a separate context: budget it with the output reserve as
  well as the positive prompt; do not concatenate it into user text.
- Tool-result media is currently native only for Anthropic; other tool-result codecs
  reject it. User media is supported as above. System media is rejected.

Protocol references (codec tests, no live calls):
[Google content parts](https://ai.google.dev/api/generate-content),
[Anthropic PDF](https://platform.claude.com/docs/en/build-with-claude/pdf-support),
[OpenAI chat](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Named DeepSeek thinking and usage

For `provider:'deepseek'`, the configured model is preserved verbatim (including
`deepseek-v4-flash`). `reasoning:'off'`, `reasoningEnabled:false`, or no configured
effort explicitly sends `thinking:{type:'disabled'}`. Enabled efforts send
`thinking:{type:'enabled'}` and `reasoning_effort`. Official mappings: minimal/low
→ low, medium/high/xhigh → high, max/ultra → max. `effort` and
`reasoning:{effort}` are also accepted; reasoningEnabled:false takes precedence.
This named mapping does not change other compatible providers' off semantics.

Thinking-mode temperature/presence_penalty/frequency_penalty and ineffective top_p
values fail before fetch instead of pretending ignored sampling controls apply.
Reasoning content survives Pi replay, including tool calls and results.

`usage.raw` preserves DeepSeek's complete usage object. Normalized input includes
cache hits; cache misses are retained separately. Output includes reasoning.
Reported total_tokens is retained; neither cache nor reasoning is added again.
See [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/) and
[usage fields](https://api-docs.deepseek.com/api/create-chat-completion/).
Fake-fetch JSON and stream tests pass. No local credentials were read; authorized
live validation is deferred to the final integration stage.

## OpenRouter reasoning and OpenAI streamed usage

Named `openrouter` sends `reasoning:{enabled:false}` for off/unconfigured mode.
Enabled modes use `{enabled:true,effort}`; `on` uses `{enabled:true}`; `budget` uses
`{enabled:true,max_tokens:reasoningBudget}` with the budget below maxOutputTokens.
JSON `reasoning` and streamed reasoning/details are decoded. Signed/encrypted
`reasoning_details` are retained in result/Pi assistant `providerContent` and replayed
as `reasoning_details` on the next OpenRouter request. Preserve providerContent when
persisting or rebuilding assistant history. Opaque blocks are never displayed as
ordinary thinking text. Stream fragments concatenate by index (or stable ID).
The provider may reject off for a model whose reasoning is mandatory; no silent
fallback is made. See [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Named `openai` streaming requests opt into `stream_options:{include_usage:true}`.
Non-stream requests omit this field; other compatible platforms are not assumed to
accept the option. A final usage-only chunk is decoded without needing a choice.
Missing/aborted usage remains unknown.

### Amount accounting and PI fatal tool outcomes

`providers/core/cost.js` exports `normalizeCost(value, {provider, sdkUsage,
sdkEstimated})` and `aggregateCost(requests)`. The result is
`{costUsd:number|null, costSource:'provider'|'sdk-estimated'|'mixed'|null,
costEstimated:boolean|null}`. Explicit `costUsd` is already USD. Only the named
OpenRouter protocol maps numeric `usage.cost` to USD; it is the account charge,
not `cost_details.upstream_inference_cost`, and these amounts must never be added.
The raw usage envelope is retained. Missing, negative, nonfinite or nonnumeric
amounts stay unknown; reported zero is valid. One unknown request makes the
aggregate unknown. Existing `cost:null` remains for compatibility; consumers use
`costUsd` and must display the estimate label when `costEstimated` is true.

PI accepts SDK `message.usage.cost.total` only when the injected model declares
`costSource:'sdk-estimated'`, or that SDK usage explicitly declares
`costEstimated:true` / `costSource:'sdk-estimated'`. The model supplier owns the
price provenance; no prices are inferred from model names. Default primary model
prices are NaN, never fabricated zero. Actual provider amounts take precedence.
SDK gateway owners can reuse the same pure cost helpers without importing PI.

A tool throwing `tool-result-unknown` or `tool-persistence-failed` now aborts the
PI turn before any further tool/model request. The public error preserves the
code but not provider exception text. Ordinary known tool failures retain SDK
error handling. Store-side final-success checks are a separate owner concern.

Protocol evidence: https://openrouter.ai/docs/cookbook/administration/usage-accounting
and https://openrouter.ai/support/ (USD-denominated credits).

## Canonical application inputs

Connections are flat objects. Provider IDs come directly from the capability
registries; removed aliases are errors. Use `reasoning` as a mode string and
`reasoningBudget` for a native token budget. Media costs belong only in
`capabilities.mediaTokenCost`. Inline media uses `data`, `mimeType`, and optional
`name`; input data URLs and `filename` are rejected. Provider-accessible remote
URLs and vendor wire fields remain protocol-specific. Auxiliary connections use
`type: embedding` or `type: image`, not an ambiguous `auxiliary` type.

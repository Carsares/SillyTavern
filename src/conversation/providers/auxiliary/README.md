# Embedding and image adapters

Exact APIs and unified dispatch are in `../chat/README.md`; the exhaustive provider
matrix is `../../capabilities/auxiliary/README.md`. **All remote platforms/models
remain live-unverified.** No store mutation, credential lookup or hidden retry.

Embedding codecs: OpenAI-compatible /embeddings (sort validated indices), Cohere
/v2/embed (float vectors, explicit input_type), Google batchEmbedContents, Ollama
/api/embed (truncate:false). All validate response count, finite numbers and equal
dimensions. `embed(texts)` returns `{embeddings,model,usage}`; retrieval can inject
`async texts => (await adapter.embed(texts)).embeddings`.

Image codecs: OpenAI-compatible images/generations; AUTOMATIC1111 txt2img;
Stability multipart SD3 image response; Horde bounded asynchronous jobs; NovelAI
generate-image ZIP. ZIP decoding filters image entries and limits individual
uncompressed files to 10 MiB, compressed archive to 20 MiB. No output is written
to disk or fetched from returned image URLs. The runtime/tool owner persists the
returned bytes/URLs and owns uncertain paid outcomes. The optional store injection
is intentionally not used because its image persistence port is not defined.

NovelAI includes the classic format and `nai-diffusion-4-*`/`nai-diffusion-4-5-*`
formats. V4/V4.5 add params_version, v4_prompt/v4_negative_prompt with base and
character captions, characterPrompts, use_coords/use_order and noise_schedule.
Optional `characters:[{prompt,negativePrompt?,center?:{x,y}}]` supports up to six
characters; `useCoordinates` controls placement. Coordinates are normalized 0..1.
NovelAI accepts `scale`, `sampler`, and `noiseSchedule`; other diffusion APIs have their own operation allowlists. The NovelAI codec
validates dimensions as multiples of 64. `novelai.js` is pure and separately tested.
These are implemented request fields, not a claim of live V4/V4.5 verification.
Stability uses aspect ratio, not a promise of
exact pixel dimensions. OpenAI supports its native size argument. Steps/seed are
controls for diffusion codecs, not silently invented OpenAI image parameters.
The caller must inspect the capability API and use only its documented options;
explicit unsupported controls now fail before network rather than being ignored.
`idempotencyKey` is accepted as runtime metadata, not sent as an invented vendor
parameter and not treated as proof of provider-side idempotence.
No adapter promises every named model supports every image size or sampling option.

References: https://docs.cohere.com/reference/embed ;
https://docs.ollama.com/api/embed ;
https://developers.openai.com/api/reference/resources/images/methods/generate ;
https://image.novelai.net/docs/index.html .

V4 feature reference: https://docs.novelai.net/en/image/multiplecharacters/ .
The local legacy request field listing at `src/endpoints/novelai.js` was read as
protocol evidence only; no legacy state or handler is reused.


## Expanded source implementation and integration ports

`createAuxiliaryAdapter(connection,{fetch,onRequest,onJob?,jobId?,pipelineFactory?,localWorkerFactory?})`
(and its `createProviderAdapter` alias) returns `capabilities`, `embed`,
`generateImage`, and `cancelJob`. Existing NovelAI classic/V4/V4.5 codec and ZIP
bounds were preserved. No dependency, shared schema, original providers.test,
SDK, store or composition edit belongs to this auxiliary follow-up.

All 19 original embedding identifiers other than explicitly excluded webllm and
all 24 original image identifiers now resolve to concrete codecs. Aliases are
explicit: palm/makersuite→google, auto→automatic1111, novel→novelai,
workersai→workers_ai, comfyui→comfy, fal→falai, mistralai→mistral.
This is implementation and injected-test coverage, not remote/model verification.

Embedding additions: named compatible endpoints (including the current KoboldCpp
/v1/embeddings API instead of importing old client-provided vectors); Nomic
embedding/text with task_type/dimensionality; Extras api/embeddings/compute;
Vertex models/{model}:predict, one input per request with autoTruncate:false;
Workers accounts/{accountId}/ai/run/{model}; and isolated offline transformers.
Vertex rejects a reported truncated embedding. All codecs check finite values,
item count, equal dimensions, and any requested dimension.

The parent must inspect `operationParameters.embed` before passing `inputType`.
Only Cohere/Google/Vertex/Nomic map it to a native task type; other adapters reject
an explicit unsupported value. Unknown options and media never silently disappear.
The current composition owner must apply that conditional when calling embed.

New image codecs include Together, SD.cpp, Extras, Pollinations, Hugging Face,
Chutes, NanoGPT, Google Gemini/Imagen, Vertex Imagen, OpenRouter image outputs,
Workers binary/JSON/multipart, BFL, FAL and Comfy. xAI explicitly uses aspect_ratio
and resolution; ZAI uses size and quality without inventing n. Vendor/model
rejection is not retried or represented as success. `generateImage` accepts only
its selected profile's `operationParameters.generateImage`, plus signal/onEvent
and durable idempotencyKey metadata. An idempotencyKey is not an upstream
idempotency guarantee. Failures after a possible submission carry
`details.outcome:'unknown'` and `resubmit:false` unless a more specific job state
is known. Image URLs are returned without automatically downloading foreign URLs.
Comfy output bytes are retrieved from its configured /view endpoint only.

### Explicit new connection configuration

- Compatible embedding bases include /v1 (or the vendor's compatible prefix).
  Vertex baseUrl is the complete .../projects/P/locations/L/publishers/google
  endpoint; supply its bearer token explicitly as apiKey. No ambient Google login.
- Workers requires accountId; baseUrl defaults to Cloudflare /client/v4. Native
  embedding and image APIs share the same connection shape.
- embeddingBaseUrl/imageBaseUrl optionally override operation-specific endpoints.
  Chutes embeddings derive a model subdomain only for a safe hostname model ID,
  or require explicit baseUrl; its default image endpoint is image.chutes.ai.
  NanoGPT embedding and image defaults have different paths. An explicit baseUrl
  overrides defaults, so set operation overrides when using one connection for both.
- Extras uses the server-configured model. `modelSelection:'server-configured'`
  is explicit; this adapter does not mutate the remote server's global model.
- transformers requires an absolute localModelPath containing the installed
  runtime's tokenizer/config/ONNX assets. It uses already installed
  sillytavern-transformers, not legacy transformers.js. A dedicated worker has
  no inherited environment/preloads, remote loading/cache writes disabled, local
  runtime assets, and is terminated/joined on abort or localTimeoutMs (default
  120000, max 600000). Actual model loading has not been run in this unit phase.
  pipelineFactory/localWorkerFactory are test injection ports, not production
  claims about an untested external implementation.

### Durable queue handles

BFL/FAL/Comfy use bounded maxPolls (1..600, default 60) and pollIntervalMs
(0..10000, default 1000). `onJob(event)` is awaited, including **before the first
poll**. States: submitting, submitted, resumed, completed, pending, failed or
unknown. Event shape:

```js
{jobId, remoteId, state, kind:'image', provider, model, resubmit:false}
// jobId is null only before a remote ID has been obtained.
```

The parent persists the **entire opaque jobId string** and the frozen input.
BFL/FAL/Comfy use `aux1.<base64url>` handles with the provider's remoteId, endpoint,
model, a request hash and validated polling paths. No API key, prompt or workflow
is stored in the handle. Resume using `generateImage({...sameInput,jobId})` or
factory `jobId`; a different body/model/endpoint is rejected. Never turn an
unknown submission with no ID into an automatic resubmit. Error details retain
jobId/remoteId, outcome and resubmit:false even if persistence or polling failed.
This module exposes persistence callbacks; it does not write to a guessed store
API. The parent must bind job handles to its own conversation/tool authorization.

Provider-returned polling URLs stay within the configured endpoint. BFL's
explicit official api[.region].bfl.ai/v1/get_result endpoints are also permitted
for regional polling. Credentials never follow arbitrary redirects/hosts.
Credential-bearing query strings are rejected before storing handles.

`cancelJob(jobId,{signal,onJob})` requests FAL per-job cancellation or deletes
only the specified pending Comfy queue item. It never calls global /interrupt.
Running Comfy jobs and BFL (no implemented cancellation endpoint) return unknown.
Horde keeps its pre-existing plain jobId resume port and implements per-job DELETE.
Cancellation acceptance returns cancel-requested, **not proof of stopped billing**.
Stopping a local await leaves remote work unknown; recovery reuses the stored ID.
FAL service-side retries are controlled by FAL, not by this adapter; this adapter
never resubmits automatically.

Comfy requires API-format workflow plus bindings, supplied on the connection or
per operation. Every explicit control must have a target; model/prompt are required.
The original graph is cloned and never mutated:

```js
{
  workflow: {
    '1': {class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'placeholder'}},
    '2': {class_type:'CLIPTextEncode',inputs:{text:'placeholder'}}
  },
  bindings: {model:[['1','ckpt_name']],prompt:[['2','text']]}
}
```

Other bindings can map negativePrompt,width,height,count,seed,steps,scale to one
or more existing node inputs. No automatic workflow guessing or code evaluation.
Use a full FAL model ID such as fal-ai/flux/schnell. Model-specific controls remain
model-dependent; known BFL ultra/1.1 restrictions fail before dispatch.

### Protocol evidence and verification

Read-only protocol evidence: src/vectors/*-vectors.js, src/endpoints/stable-diffusion.js,
src/endpoints/google.js and original source enumerations. No legacy handler,
configuration, credential lookup, saved data or startup path is imported.
Additional primary sources:

- https://github.com/LostRuins/lite.koboldai.net/blob/main/koboldcpp_api.json (/v1/embeddings)
- https://github.com/nomic-ai/nomic/blob/main/nomic/embed.py (task_type/dimensionality)
- https://fal.ai/docs/documentation/model-apis/inference/queue (submit/status/result/cancel)
- https://github.com/Comfy-Org/ComfyUI/blob/master/server.py (prompt/history/view/queue)
- https://help.bfl.ai/articles/8446125349-quickstart-guide (returned polling URL)
- https://ai.google.dev/gemini-api/docs/image-generation (Gemini image parts)
- https://docs.x.ai/developers/model-capabilities/images/generation (aspect/resolution)

Validation command: `node --test tests/conversation/modules/providers/*.test.mjs`.
New auxiliary tests cover every registered embedding codec, named image protocols,
unknown-parameter/media rejection, durable resume without second submission,
persistence failure, abort, per-job cancellation, regional URLs and local worker
shutdown. No HTTP server, real provider, model download, inference engine or saved
credential was used. Final network/composition/UI integration remains separate.

### Usage normalization

`usage.raw` preserves the original usage envelope (including modality/cost details),
Cohere `meta`, Ollama counters, or Vertex per-request embedding statistics. It never
contains generated media, embedding vectors or prompts. Vertex also exposes
`usage.requests`; an unknown member count keeps its aggregate unknown.

The six standard token counts use `null` for absent/invalid values, including
embedding output counts that the server did not report. `totalTokens` preserves
an explicit provider total; otherwise it is computed only from known input and
output. Cohere billed units are not substituted for actual token counts.

OpenAI/OpenRouter cache and reasoning counts are included in their input/output
totals, as recorded by `cacheReadIncludedInInput`, `cacheWriteIncludedInInput`
and `reasoningIncludedInOutput`. Unknown inclusion semantics remain `null`.
Google output is candidates plus thoughts; if either is missing the inclusive
output is unknown, while an explicitly reported total remains available. Cached
prompt tokens are a subset of Google input and are not added again.

Protocol references: https://ai.google.dev/gemini-api/docs/generate-content/tokens
and https://openrouter.ai/docs/guides/best-practices/prompt-caching .
Usage regression tests: `tests/conversation/modules/providers/auxiliary-usage.test.mjs`.

`usage.complete` is true only after successful request completion and known,
explicitly reported input/output/total counts (Google output combines explicitly
reported candidates and thoughts). A derived total alone does not establish
completeness. Partial/missing usage stays false; no missing counter is replaced
with zero. Multi-request completeness requires every request to be complete.

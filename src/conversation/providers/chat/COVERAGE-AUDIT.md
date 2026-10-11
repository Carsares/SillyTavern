# Final provider coverage audit

Scope: AGENT-PLAN sections 10.2, 10.3 and 13; provider codecs/capabilities and their
composition ports. Status is based on current code and local unit tests. It is not
an integration, Docker or live-provider certification. Live-unverified does not mean
missing implementation. This replaces the obsolete auxiliary handoff gap lists.

## Final implementation status

| Requirement | Current status | Evidence |
| --- | --- | --- |
| All named chat sources | Implemented: all 26 original identifiers plus aliases, with native Anthropic/Google/Vertex/Cohere/AI21/Azure and compatible codecs. | capabilities/chat/index.js; chat/index.js, protocol.js, stream.js |
| Text sources | Implemented: all 15 textgen_types plus Kobold/NovelAI/Horde; tools explicitly unsupported. | capabilities/text/index.js; text/index.js, stream.js |
| Audio/video/document input | Implemented according to protocol: Google/Vertex audio/video/document, Anthropic PDF, OpenAI audio/PDF, KoboldCpp image/audio, Ollama image. Explicit media token costs required; unsupported combinations reject. | chat/media.js; text/media.js; bridge.js |
| Text media/template interface | Earlier blockers removed in current code. Compiler extracts textual template content while retaining typed blocks; frozen renderer compares full typed content. Static confirmation only in this audit. | public/shared/conversation/assembly/index.js; composition/helpers.js |
| Positive/negative guidance | Implemented for ooba/KoboldCpp with native guidance_scale/negative_prompt. Unsupported profiles reject. PI now checks negative-context budget before model work. | capabilities/text/index.js; providers/text/index.js; executors/pi/index.js |
| NovelAI stopping | Implemented native token-ID stop_sequences for JSON/stream. Actual local Clio/Kayra/Erato tokenizers and an explicit tokenize injection port. Unknown model with configured nonempty stops fails synchronous capability/adapter preflight. | capabilities/text/novel-tokenizers.js; providers/text/novel-tokenizer.js |
| Native reasoning | Implemented Anthropic/Google/Cohere controls and streams; named DeepSeek disabled/enabled and effort mapping. OpenRouter unified reasoning/off controls and signed/encrypted detail replay are implemented. | chat/reasoning.js, openrouter.js, protocol.js, stream.js, bridge.js |
| Streaming usage | Named OpenAI requests include_usage; usage-only terminal chunks are decoded. Chat/text retain provider usage and inclusion flags, preserving unknown counters. | chat/index.js, protocol.js; text/usage.js |
| Complete auxiliary coverage | Implemented all 19 required embedding identifiers and all 24 image identifiers; no named auxiliary code gaps remain from this review. | capabilities/auxiliary/index.js; providers/auxiliary/{embedding,image-native,index}.js |
| Auxiliary usage | Earlier raw-usage gap fixed: protocol-specific normalization, original envelopes/counters and multi-request aggregation are implemented. | providers/auxiliary/usage.js; auxiliary-usage.test.mjs |
| Queued image protocols | ComfyUI workflow/queue/history/output, BFL/FAL submit/poll/resume, bounded waits and explicit cancellation outcomes implemented. | providers/auxiliary/jobs.js, image-native.js |
| Horde durable jobs | jobId/onJob resume port implemented; current composition records/resumes provider jobs for text/image. No duplicate submission on resume. Composition behavior is statically confirmed here, not integration-tested. | providers/chat/http.js; composition/provider-jobs.js; composition/index.js |

## Named auxiliary inventory

Embedding: transformers, mistral, openai, extras, palm (Google alias), togetherai,
nomicai, cohere, ollama, llamacpp, vllm, koboldcpp, vertexai, electronhub, openrouter,
chutes, nanogpt, siliconflow, workers_ai. WebLLM is explicitly excluded by plan 0.2.
These use concrete compatible/native embedding codecs; transformers has offline
local inference with cancellation. They do not read old settings or vector state.

Image: extras, horde, auto, sdcpp, novel, vlad, openai, aimlapi, comfy, togetherai,
drawthings, pollinations, stability, huggingface, chutes, electronhub, nanogpt, bfl,
falai, xai, google, zai, openrouter, workersai. Aliases select implemented codecs.
NovelAI includes V4/V4.5 positive/negative multi-character encoding. Google supports
Gemini/Imagen formats; Vertex prediction, Workers binary/JSON, and native queued
protocols are distinct from the compatible images/generations codec.

The plan does not mandate copying every legacy img2img/inpaint/upscale/reference
UI tool. Those are not treated as omissions of this text-to-image provider scope.

## NovelAI preflight and deployment contract

Default supported model IDs are explicitly enumerated: clio/clio-v1,
kayra/kayra-v1, erato/erato-v1. Future-looking names such as kayra-v2 and erato-next
are not guessed to use an existing vocabulary. With nonempty stop strings and no
actual injected tokenize function, capability.supported is false and types is empty;
adapter construction fails before generation. Without stops, tokenization is not
required and an otherwise valid connection remains eligible.

`getTextCapabilities(connection,{tokenize})` and
`providerCapabilities(connection,{tokenize})` accept the same actual function used
by `createProviderAdapter`/`createProviderStream`. Connection data cannot claim an
injection through a boolean. Hosts adding custom tokenizers must wire the function
to both preflight and execution. `stopTokenization` reports supported/family/source.

Read-only assets must be shipped at src/tokenizers/nerdstash.model,
src/tokenizers/nerdstash_v2.model and src/tokenizers/llama3.json. Existing installed
@agnai/sentencepiece-js and @agnai/web-tokenizers are sufficient; no new dependency
or download is needed. Container asset copying belongs to the parent; Docker has
not been executed by this audit.

## Verification and limits

- `node --test tests/conversation/modules/providers/*.test.mjs`: **185 passed,
  0 failed**, exit 0. Includes auxiliary codec/usage/job tests.
- Focused original provider files: **117 passed, 0 failed**, exit 0.
- A fresh tokenizer instance loaded all three real assets with fetch, HTTP/HTTPS
  requests and socket connections replaced by failing test doubles. `Hello` encoded
  to Clio [13071], Kayra [13071], Erato [9906]. No downloads/network were used.
- Tests use fake provider responses and synthetic credentials. No integration,
  server startup, paid model calls, package changes, Docker execution or Git writes.
- Model-specific remote acceptance, mandatory-reasoning restrictions, deployed
  asset availability and end-to-end persistence/UI behavior remain for final
  integration/live validation; they are not reported as missing provider code.

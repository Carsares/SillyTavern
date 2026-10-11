# text capability coverage

All rows have concrete codecs and fake-fetch unit coverage. **All live platforms/models are unverified**; no SDK-loop integration, real endpoint, paid request or browser check was run. Catalog coverage is not a claim of verified model features.

Generation types: send, regenerate, continue, impersonate, auxiliary, group. Auxiliary profiles expose their listed operations instead of generation. tools/media describe protocol limits; effective media requires explicit mediaTokenCost. Unknown provider/protocol and unsupported parameters fail closed.

| Provider identifier | Wire API | Default baseUrl | Path / operations | Tools | Protocol media | Streaming | Parameters |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ooba | openai-text | explicit connection baseUrl required | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| mancer | openai-text | https://neuro.mancer.tech | oai/v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| vllm | openai-text | explicit connection baseUrl required | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| aphrodite | openai-text | explicit connection baseUrl required | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| tabby | openai-text | explicit connection baseUrl required | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| togetherai | openai-text | https://api.together.xyz | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| infermaticai | openai-text | https://api.totalgpt.ai | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| dreamgen | openai-text | https://dreamgen.com | api/openai/v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| openrouter | openai-text | https://openrouter.ai/api | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| featherless | openai-text | https://api.featherless.ai | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| openai-compatible | openai-text | explicit connection baseUrl required | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| kobold | kobold | explicit connection baseUrl required | api/v1/generate | false | text | false | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| koboldcpp | kobold | explicit connection baseUrl required | api/v1/generate | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| novelai | novelai | https://text.novelai.net | ai/generate | false | text | true | temperature, top_p, top_k, repetition_penalty, seed |
| horde | horde-text | https://aihorde.net/api/v2 | generate/text/async | false | text | false | temperature, top_p, top_k, repetition_penalty, seed, stop |
| llamacpp | llamacpp | explicit connection baseUrl required | completion | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| ollama | ollama-generate | http://127.0.0.1:11434 | api/generate | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| huggingface | huggingface-tgi | explicit connection baseUrl required | generate | false | text | true | temperature, top_p, top_k, repetition_penalty, seed, stop |

API contracts, reasoning modes, model-specific limits, source references and composition: ../../providers/chat/README.md. This index exports its registry plus getTextCapabilities. It does not modify capabilities/core.

verified is accepted only from explicit connection.capabilities. liveVerified stays false. Core-owned validation still checks trusted media costs, finite budgets and verified reasoning effort declarations. Native budget/adaptive/on modes use the reasoning string directly; PI scheduling does not require a separate effort field.

Guidance is explicitly registered only for ooba/koboldcpp using `guidance_scale`
and `negative_prompt`; `guidance` describes the wire fields. KoboldCpp image/audio
and Ollama image inputs require explicit mediaTokenCost. Other profiles remain
text-only. All text profiles have tools:false; live model behavior is unverified.

NovelAI supports string/array `stop`; the adapter tokenizes to native stop_sequences
using local Clio/Kayra/Erato assets or an explicit tokenize dependency. A configured
unknown model needs that dependency when stops are nonempty.

NovelAI tokenizer preflight is synchronous: getTextCapabilities(connection,{tokenize})
returns stopTokenization {supported,family,source,reason?}. With configured nonempty
stops, unknown model IDs fail supported/types before model work. Default IDs are
clio/clio-v1, kayra/kayra-v1, erato/erato-v1; future revisions are not guessed.
Custom hosts must pass the same actual tokenize function to capability resolution
and adapter execution. A configuration boolean cannot enable an unavailable codec.

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
| generic | openai-text | explicit connection baseUrl required | v1/completions | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| kobold | kobold | explicit connection baseUrl required | api/v1/generate | false | text | false | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| koboldcpp | kobold | explicit connection baseUrl required | api/v1/generate | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| novelai | novelai | https://text.novelai.net | ai/generate | false | text | true | temperature, top_p, top_k, repetition_penalty, seed |
| horde | horde-text | https://aihorde.net/api/v2 | generate/text/async | false | text | false | temperature, top_p, top_k, repetition_penalty, seed, stop |
| llamacpp | llamacpp | explicit connection baseUrl required | completion | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| ollama | ollama-generate | http://127.0.0.1:11434 | api/generate | false | text | true | temperature, top_p, top_k, min_p, repetition_penalty, seed, stop |
| huggingface | huggingface-tgi | explicit connection baseUrl required | generate | false | text | true | temperature, top_p, top_k, repetition_penalty, seed, stop |

API contracts, reasoning modes, model-specific limits, source references and composition: ../../providers/chat/README.md. This index exports its registry plus getCapabilities (alias getTextCapabilities). It does not modify capabilities/core.

verified is accepted only from explicit connection.capabilities. liveVerified stays false. Core-owned validation still checks trusted media costs, finite budgets and verified reasoning effort declarations. Native budget/adaptive/on modes are distinct from Pi effort levels; supply connection.effort when required by core.

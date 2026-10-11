# chat capability coverage

All rows have concrete codecs and fake-fetch unit coverage. **All live platforms/models are unverified**; no SDK-loop integration, real endpoint, paid request or browser check was run. Catalog coverage is not a claim of verified model features.

Generation types: send, regenerate, continue, impersonate, auxiliary, group. Auxiliary profiles expose their listed operations instead of generation. tools/media describe protocol limits; effective media requires explicit mediaTokenCost. Unknown provider/protocol and unsupported parameters fail closed.

| Provider identifier | Wire API | Default baseUrl | Path / operations | Tools | Protocol media | Streaming | Parameters |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai | openai-chat | https://api.openai.com/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| openai-compatible | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| openai_compatible | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| custom | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| openrouter | openai-chat | https://openrouter.ai/api/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| mistralai | openai-chat | https://api.mistral.ai/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| perplexity | openai-chat | https://api.perplexity.ai | chat/completions | false | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| groq | openai-chat | https://api.groq.com/openai/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| electronhub | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| chutes | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| nanogpt | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| deepseek | openai-chat | https://api.deepseek.com/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| aimlapi | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| xai | openai-chat | https://api.x.ai/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| pollinations | openai-chat | https://gen.pollinations.ai/v1 | chat/completions | false | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| moonshot | openai-chat | https://api.moonshot.ai/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| fireworks | openai-chat | https://api.fireworks.ai/inference/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| cometapi | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| zai | openai-chat | https://api.z.ai/api/paas/v4 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| siliconflow | openai-chat | https://api.siliconflow.com/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| workers_ai | openai-chat | explicit connection baseUrl required | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| minimax | openai-chat | https://api.minimax.io/v1 | chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| anthropic | anthropic-messages | https://api.anthropic.com/v1 | messages | true | text, image | true | temperature, top_p, top_k, stop |
| google | google-generate-content | https://generativelanguage.googleapis.com/v1beta | models/{model}:generateContent | true | text, image | true | temperature, top_p, top_k, stop, seed |
| vertexai | google-vertex | explicit connection baseUrl required | models/{model}:generateContent | true | text, image | true | temperature, top_p, top_k, stop, seed |
| cohere | cohere-v2 | https://api.cohere.com/v2 | chat | true | text | true | temperature, top_p, top_k, stop, frequency_penalty, presence_penalty, seed |
| ai21 | ai21-jamba | https://api.ai21.com/studio/v1 | chat/completions | true | text | true | temperature, top_p, stop, frequency_penalty, presence_penalty |
| azure_openai | azure-chat | explicit connection baseUrl required | openai/deployments/{deployment}/chat/completions | true | text, image | true | temperature, top_p, stop, frequency_penalty, presence_penalty, seed |
| claude | anthropic-messages | https://api.anthropic.com/v1 | messages | true | text, image | true | temperature, top_p, top_k, stop |
| makersuite | google-generate-content | https://generativelanguage.googleapis.com/v1beta | models/{model}:generateContent | true | text, image | true | temperature, top_p, top_k, stop, seed |

API contracts, reasoning modes, model-specific limits, source references and composition: ../../providers/chat/README.md. This index exports its registry plus getCapabilities (alias getChatCapabilities). It does not modify capabilities/core.

verified is accepted only from explicit connection.capabilities. liveVerified stays false. Core-owned validation still checks trusted media costs, finite budgets and verified reasoning effort declarations. Native budget/adaptive/on modes are distinct from Pi effort levels; supply connection.effort when required by core.

# auxiliary capability coverage

All rows have concrete codecs and fake-fetch unit coverage. **All live platforms/models are unverified**; no SDK-loop integration, real endpoint, paid request or browser check was run. Catalog coverage is not a claim of verified model features.

Generation types: send, regenerate, continue, impersonate, auxiliary, group. Auxiliary profiles expose their listed operations instead of generation. tools/media describe protocol limits; effective media requires explicit mediaTokenCost. Unknown provider/protocol and unsupported parameters fail closed.

| Provider identifier | Wire API | Default baseUrl | Path / operations | Tools | Protocol media | Streaming | Parameters |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai | openai-auxiliary | https://api.openai.com/v1 | embed, generateImage | false | text | false | none |
| openai-compatible | openai-auxiliary | explicit connection baseUrl required | embed, generateImage | false | text | false | none |
| cohere | cohere-embed | https://api.cohere.com/v2 | embed | false | text | false | none |
| google | google-embed | https://generativelanguage.googleapis.com/v1beta | embed | false | text | false | none |
| ollama | ollama-embed | http://127.0.0.1:11434 | embed | false | text | false | none |
| stability | stability-image | https://api.stability.ai | generateImage | false | text | false | none |
| automatic1111 | sd-webui-image | explicit connection baseUrl required | generateImage | false | text | false | none |
| horde | horde-image | https://aihorde.net/api/v2 | generateImage | false | text | false | none |
| novelai | novelai-image | https://image.novelai.net | generateImage | false | text | false | none |

API contracts, reasoning modes, model-specific limits, source references and composition: ../../providers/chat/README.md. This index exports its registry plus getCapabilities (alias getAuxiliaryCapabilities). It does not modify capabilities/core.

verified is accepted only from explicit connection.capabilities. liveVerified stays false. Core-owned validation still checks trusted media costs, finite budgets and verified reasoning effort declarations. Native budget/adaptive/on modes are distinct from Pi effort levels; supply connection.effort when required by core.

# Auxiliary capability coverage

All named rows have implemented codecs; live platforms/models remain unverified.
WebLLM is excluded by the project plan. Unknown providers, media and operation
fields fail before dispatch. No user config can silently add an operation field.

getAuxiliaryCapabilities(connection) exposes operations, operationParameters,
embedApi/imageApi, jobRecovery, cancellation, modelSelection and local. types stays
empty: these operations are not chat generation. Parameter support is per protocol,
not a promise that every remote model accepts every value. Consult the adapter
README for model-specific refusals and recovery semantics.

| Identifier | Embedding codec | Image codec | Default base URL |
| --- | --- | --- | --- |
| openai | openai-auxiliary | openai-auxiliary | https://api.openai.com/v1 |
| openai-compatible | openai-auxiliary | openai-auxiliary | explicit/local |
| cohere | cohere-embed | — | https://api.cohere.com/v2 |
| google | google-embed | google-image | https://generativelanguage.googleapis.com/v1beta |
| vertexai | vertex-embed | vertex-image | explicit/local |
| ollama | ollama-embed | — | http://127.0.0.1:11434 |
| stability | — | stability-image | https://api.stability.ai |
| automatic1111 | — | sd-webui-image | explicit/local |
| horde | — | horde-image | https://aihorde.net/api/v2 |
| novelai | — | novelai-image | https://image.novelai.net |
| mistral | openai-auxiliary | — | https://api.mistral.ai/v1 |
| llamacpp | openai-auxiliary | — | explicit/local |
| vllm | openai-auxiliary | — | explicit/local |
| koboldcpp | openai-auxiliary | — | explicit/local |
| siliconflow | openai-auxiliary | — | https://api.siliconflow.com/v1 |
| togetherai | openai-auxiliary | together-image | https://api.together.xyz/v1 |
| electronhub | openai-auxiliary | openai-auxiliary | https://api.electronhub.ai/v1 |
| openrouter | openai-auxiliary | openrouter-image | https://openrouter.ai/api/v1 |
| chutes | openai-auxiliary | chutes-image | explicit/local |
| nanogpt | openai-auxiliary | nanogpt-image | https://nano-gpt.com/api/v1 |
| workers_ai | workers-embed | workers-image | https://api.cloudflare.com/client/v4 |
| nomicai | nomic-embed | — | https://api-atlas.nomic.ai/v1 |
| extras | extras-embed | extras-image | explicit/local |
| transformers | transformers-embed | — | explicit/local |
| sdcpp | — | sdcpp-image | explicit/local |
| vlad | — | sd-webui-image | explicit/local |
| drawthings | — | sd-webui-image | explicit/local |
| aimlapi | — | openai-auxiliary | https://api.aimlapi.com/v1 |
| xai | — | xai-image | https://api.x.ai/v1 |
| zai | — | zai-image | https://api.z.ai/api/paas/v4 |
| pollinations | — | pollinations-image | https://gen.pollinations.ai |
| huggingface | — | huggingface-image | https://router.huggingface.co/hf-inference/models |
| comfy | — | comfy-image | explicit/local |
| bfl | — | bfl-image | https://api.bfl.ai/v1 |
| falai | — | fal-image | https://queue.fal.run |

Operation defaults may differ: Chutes/NanoGPT have separate imageBaseUrl.
Vertex needs its project/location/publisher path. Workers requires accountId.
Local transformers needs localModelPath; no model download is implicit. Extras
explicitly uses a server-configured model. Native image inputs are text only; no
unimplemented media transformation is advertised.

NovelAI classic/V4/V4.5 fields and multi-character codec were preserved.
Full interface, queue jobId/onJob persistence port and protocol sources:
[adapter README](../../providers/auxiliary/README.md).

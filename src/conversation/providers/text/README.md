# Text provider protocols

All 15 `textgen_types` identifiers plus kobold/novelai/horde have concrete adapters;
the exhaustive table is `../../capabilities/text/README.md`. **All remote platforms
are live-unverified.** Only fake-fetch protocol tests ran. No legacy state or engine
is imported. `createTextAdapter` (alias `createProviderAdapter`) has the same
generate contract as the unified factory in `../chat/README.md`.

Text requests require an explicit `prompt`; tools and media are rejected. Pi uses
`createProviderStream` from `../chat/bridge.js` with injected `renderPrompt`.
No text adapter supplies its own model/tool loop.

OpenAI-text uses `/completions` with prompt; llama.cpp uses `/completion` and
n_predict/repeat_penalty; Ollama uses `/api/generate`, raw:true, num_predict and
NDJSON streaming. TGI uses `/generate` or `/generate_stream` and max_new_tokens.
Kobold uses max_length/max_context_length; KoboldCpp streams tokens from
`/api/extra/generate/stream`. NovelAI uses input/model/parameters with use_string,
`/ai/generate` or `/ai/generate-stream`. The token-SSE variants terminate on a clean
HTTP EOF, unlike APIs with explicit completion events; a connection reset still
fails, but clean premature EOF cannot be distinguished by that wire protocol.

Horde submits once to `/generate/text/async`, polls status using apikey, and is
bounded by maxPolls (default 60, maximum 600), pollIntervalMs (default 1000,
0..10000), request timeout and AbortSignal. `provider-poll-limit` exposes jobId for
recovery; never resubmit the original job automatically. Classic Kobold and Horde
use JSON/polling, so streaming:false is explicit. All other catalog text codecs
implement native streams; `stream:false` selects the JSON path for preview/tests.
Provider usage stays null if absent; no fake count or price is inserted.

Text-compatible base URLs are **roots preceding the catalog path**. For example,
vLLM root `http://host:8000` appends `v1/completions`; DreamGen appends
`api/openai/v1/completions`. Do not add the version twice. Generic explicitly means
the OpenAI text-completion protocol; it does not guess arbitrary server protocols.

NovelAI and KoboldCpp token-stream shapes are covered by synthetic fixtures but
their live Swagger endpoints were unavailable during this task. They remain
unverified on actual platforms, including tokenizer/model variants. HF TGI means
a deployed TGI endpoint; it does not claim support for every HF routed provider.

References: https://docs.ollama.com/api/generate ;
https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/consuming_tgi ;
https://github.com/LostRuins/lite.koboldai.net/blob/main/koboldcpp_api.json ;
https://text.novelai.net/docs/index.html ; https://aihorde.net/api/ .

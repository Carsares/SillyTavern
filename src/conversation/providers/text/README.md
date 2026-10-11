# Text provider protocols

All 15 `textgen_types` identifiers plus kobold/novelai/horde have concrete adapters;
the exhaustive table is `../../capabilities/text/README.md`. **All remote platforms
are live-unverified.** Only fake-fetch protocol tests ran. No legacy state or engine
is imported. `createTextAdapter` has the same
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

Horde recovery port: `generate({prompt,jobId?,onJob?,...})` or factory options
`{jobId,onJob}`. The awaited `onJob({jobId,state,kind})` fires immediately after
submission and before polling. Supplying a persisted jobId performs GET polling
only. All polling/callback failures carry `error.details.jobId` and `resubmit:false`.
Image Horde supports the same arguments. The runtime must persist the callback
and reload the ID after restart; this adapter does not invent a store transaction.
Existing main-thread composition has not wired these hooks yet (static audit).

## Guidance, media and raw usage

`connection.parameters: {guidance_scale:1.5, negative_prompt:'avoid this'}` is
supported by **ooba and koboldcpp** in both JSON and streamed requests, alongside
the explicitly compiled positive `generate({prompt})`. Scale must be finite and
positive; negative prompt must be a string (empty is valid). Other profiles reject
these parameters rather than pretending an ignored field enables guidance.
Sources: [ooba parameters](https://github.com/oobabooga/textgen/wiki/03-%E2%80%90-Parameters-Tab)
and [KoboldCpp implementation](https://github.com/LostRuins/koboldcpp/blob/concedo/koboldcpp.py).

KoboldCpp supports user image/audio blocks via `images`/`audio` base64 side channels;
Ollama supports `images`. Supply these in `messages[].content` alongside a compiled
`prompt`; text tools remain unsupported. Every media type needs a positive explicit
mediaTokenCost. Other text profiles reject media. No uploads or implicit conversion.

All results have `usage.raw` (null when unavailable). Compatible providers retain
their complete usage envelope. Ollama/llama.cpp retain reported count/timing fields;
TGI retains generated-token/finish/seed metadata without copying generated text.
Stream and JSON use the same normalization. Actual platform/model execution remains
unverified; tests use injected fetch only.

## NovelAI stop strings and tokenizer port

Set `connection.parameters.stop` to a string or array of strings. Both JSON and
stream requests encode it into native `parameters.stop_sequences:number[][]`;
there is no string `stop` on the wire and no estimated token-ID fallback.

`createProviderAdapter(connection, {tokenize})` optionally injects
`async tokenize(text, {model,signal}) => number[] | Int32Array`.
The same dependency can be passed to `createProviderStream(connection,{tokenize,...})`.
Without injection, `text/novel-tokenizer.js` uses the existing installed libraries
and read-only bundled tokenizer assets: Clio → nerdstash, Kayra → nerdstash_v2,
Erato → llama3. No legacy engine/settings imports, network downloads or package
changes. Unknown models with nonempty stops require an injected tokenizer.
Empty strings, more than 1024 sequences, invalid IDs and cancellation reject before
fetch. `tokenizeNovelText` and `createNovelTokenizer` are also exported for direct
local encoding. Unit tests exercise actual bundled tokenizers and fake upstreams;
remote generation and integration remain unverified.

Preflight follow-up: `getTextCapabilities(connection,{tokenize})` checks the explicit model/tokenizer registry before adapter
construction. Known IDs: clio/clio-v1, kayra/kayra-v1, erato/erato-v1. An unknown ID
with nonempty stops requires the actual tokenize function in both preflight and
execution dependencies. `stopTokenization` exposes its family/source for hosts.
Ship src/conversation/providers/text/assets/{nerdstash.model,nerdstash_v2.model,llama3.json} read-only in
containers; paths are resolved from the module URL, not the process directory.
Fresh offline-load unit tests disable all network entry points and load all assets.

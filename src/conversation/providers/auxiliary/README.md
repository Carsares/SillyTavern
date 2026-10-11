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

NovelAI's implemented request is the classic k_euler/scale/negative_prompt schema;
model variants requiring different V4 prompt structures require an explicitly
verified model/profile before use. Stability uses aspect ratio, not a promise of
exact pixel dimensions. OpenAI supports its native size argument. Steps/seed are
controls for diffusion codecs, not silently invented OpenAI image parameters.
The caller must inspect the capability API and use only its documented options.
No adapter promises every named model supports every image size or sampling option.

References: https://docs.cohere.com/reference/embed ;
https://docs.ollama.com/api/embed ;
https://developers.openai.com/api/reference/resources/images/methods/generate ;
https://image.novelai.net/docs/index.html .

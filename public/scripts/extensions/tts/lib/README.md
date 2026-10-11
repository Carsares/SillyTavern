# Vendored Kokoro Runtime

`kokoro.web.js` is the vendored browser runtime used by `../kokoro.js`. Its upstream project is [kokoro-js](https://www.npmjs.com/package/kokoro-js) by hexgrad and is distributed under the Apache-2.0 license.

The bundled file is the version source of truth. Do not update a version number in this note without replacing and verifying the bundle itself.

When replacing the runtime:

- keep the worker-facing generation API compatible with `kokoro.js`;
- verify chunked `AsyncGenerator<Response>` playback;
- verify model loading, voice selection, cancellation, and worker disposal;
- record the upstream version in the change or commit that replaces the bundle.

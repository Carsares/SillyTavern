# Connection transport contract

`proxy.js` exports two synchronous factories/helpers. Neither reads old settings
or proxy environment variables. No dependency or schema changes are required.

```js
import { createConnectionFetch, validateConnectionProxy } from './proxy.js';

validateConnectionProxy(connection); // normalized SECRET URL, or null; may throw
const transport = createConnectionFetch(connection); // { fetch, close }
try {
    // Inject this into the executor, embedding/image adapter or resumable job.
    // Consume response bodies before leaving the scope.
    const response = await transport.fetch(url, { method: 'POST', body, signal });
    return await response.json();
} finally {
    transport.close();
}
```

## Validation and parent integration

- Accept either a connection value or `{data: connection}`. Missing `proxy` or
  `proxy:null` means direct transport. Only `proxy:{url:string}` is accepted.
- URL length is 1..4096 characters, HTTP/HTTPS only, with a hostname and optional
  valid nonzero port. Only the root path is allowed; query, fragment, whitespace,
  backslash, malformed credential escapes and credential control characters are
  rejected. URL username/password are supported, including percent encoding.
- Failure throws `ProtocolError` with `code:'invalid-proxy'` and a fixed safe
  message. Resource and capability owners should call the validator before
  accepting/sending a connection. Its successful return value is secret, never
  a public capability field. Resource updates preserve omitted proxy and clear
  explicit null; this persistence rule remains the resource owner's job.
- The parent must redact the entire proxy value, original/normalized URL and
  decoded credentials from public resources, snapshots and traces. This module
  does not log or include the proxy URL in its errors.
- Create once per owned connection/turn or auxiliary job scope, inject `.fetch`
  into every provider and the SDK upstream gateway, and close in `finally` after
  stream consumption. A service-scoped instance can instead close at service
  shutdown. Do not create a new instance inside each fetch invocation. SDK
  subprocesses continue to address only the local gateway; do not put proxy
  credentials or environment proxy settings into their environment.

## Fetch and lifecycle semantics

Default transport uses installed node-fetch and proxy-agent for both direct and
proxied requests. The proxy selection callback is constant; HTTP_PROXY,
HTTPS_PROXY, ALL_PROXY, NO_PROXY and lowercase variants cannot change routing.
TLS certificate verification is forced for both the HTTPS proxy and destination.
Caller agent/TLS/dispatcher overrides are not forwarded. Proxy-Authorization in
request headers is removed; only the configured proxy URL supplies credentials.
Redirects fail, even if a caller asks to follow them. There is no retry or direct
fallback. HTTP error statuses remain responses for adapter-specific handling.

Returns global `Response` with a Web ReadableStream, supporting provider stream
readers, `.json()`, `.arrayBuffer()`, multipart uploads, HEAD and empty statuses.
`close()` is synchronous and idempotent, aborts active network work and streaming
bodies, and destroys both cached proxy agents and direct agents. Subsequent
fetch rejects with `transport-closed`. Request failures use a fixed
`provider-network-error`; aborted requests use `aborted`. The Web stream is pull-based rather than `Readable.toWeb()`: on Node 24 that adapter throws an uncaught `ERR_INVALID_STATE` when buffered data arrives after an early close.

`createConnectionFetch(connection, {fetch: injectedFetch})` is an explicit testing
or transport extension point. The function receives a **global Request** and
`{agent, redirect:'error'}` and returns a global Response or node-fetch Response.
When proxy is configured it **must honor the Node agent**, rather than calling
native fetch, which ignores `agent`. Passing `globalThis.fetch` with a proxy is
therefore rejected with `invalid-transport`; omit the option in production to
use the built-in conversion. No injection is silently discarded or replaced.

Agent objects are reused, but outer socket keep-alive is disabled: with the
installed proxy-agent stack, socket reuse skips the HTTP proxy absolute URL
rewrite on the second request. A local regression test verifies both requests.

## Global agent mode

`createConnectionFetch(connection, {agent: 'global'})` is for main-application
endpoints (currently `src/endpoints/image-generation.js`) that must follow the
host's `requestProxy` and `privateAddressWhitelist` settings. Those settings
replace `http.globalAgent`/`https.globalAgent`, so this mode creates no proxy
agent and calls node-fetch without an `agent`; an injected fetch receives
`{redirect:'error'}` and no agent. A connection `proxy` and `globalThis.fetch`
(native fetch ignores the global agents) are rejected with `invalid-transport`.
`close()` aborts active work but never destroys the shared global agents. Any
other `agent` value is rejected. Agent conversations never pass this option.

`tests/conversation/modules/providers/proxy.test.mjs` uses only local ephemeral
HTTP listeners and synthetic credentials. It verifies actual proxy forwarding,
authentication, no fallback, ignored environment routing, CONNECT refusal,
request/stream cancellation, repeated requests and Web fetch compatibility.
It does not claim a live authenticated HTTPS proxy or production provider test.

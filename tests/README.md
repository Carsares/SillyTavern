# Tests

Jest unit tests (`*.test.js`) and Playwright end-to-end tests (`modern-*.e2e.js`). Install the dependencies with
`npm ci --prefix tests` once.

## Running Playwright

Use the Playwright binary installed in `tests/`, either from `tests/` (what CI does) or by its path from the repository
root:

```bash
cd tests && npx playwright test --project=default --workers=1
./tests/node_modules/.bin/playwright test tests/modern-core-plumbing.e2e.js --config=tests/playwright.config.js
```

Do not run `npx playwright` from the repository root. The root `node_modules` holds a different Playwright version
(1.61.x) than `tests/node_modules` (1.56.x, the one the specs import `@playwright/test` from), and the run aborts with
"Playwright Test did not expect test.describe() to be called here ... You have two different versions of
@playwright/test".

The `default` project is served by a managed mock server that Playwright starts on demand and stops when the run ends.
`real-backend` and `external` run only when named with `--project`.

## Isolated runs (several runs at the same time)

Runs that share the default server (port 8100) stop each other's server: the run that started it also stops it, and the
others fail with `ERR_CONNECTION_REFUSED`. Give every concurrent run its own port and its own artifact directory:

```bash
PLAYWRIGHT_MOCK_PORT=8123 ./tests/node_modules/.bin/playwright test <files> \
    --config=tests/playwright.config.js --workers=2 --output=/tmp/<unique>
```

| Variable | Effect |
| --- | --- |
| `PLAYWRIGHT_MOCK_PORT` | Port of the managed mock server. Default `8100`. Must be an integer from 1024 to 65535 and not `8000` (the development server). |
| `PLAYWRIGHT_BASE_URL` | Test an already running server instead: no server is started and `PLAYWRIGHT_MOCK_PORT` is ignored. |
| `CI` | Do not reuse a server that already listens on the port; the run fails instead. |

A port other than 8100 also moves the server data root to `tests/.e2e-data-<port>/` and the default artifact directory
to `tests/test-results-<port>/` (both gitignored; `--output` overrides the latter). Port 8100 keeps `tests/.e2e-data/`
and `tests/test-results/`. Pick a different port per run; a run reuses whatever server already answers on its port.

## Bridge stub for specs

`mockBridgeFrame(page, { replies })` in `modern-test-utils.js` replaces the hidden legacy engine iframe
(`/index.html?modernBridge=1`). It returns a live array of `{ action, payload }` for every bridge request the page posts,
and answers each action from `replies` (a value, or a sync/async function `(payload, call) => result`; a thrown error
becomes a bridge error; unlisted actions get `{ ok: true }`). Call it before the page loads:

```js
const calls = await mockBridgeFrame(page, { replies: { status: ({ chat }) => ({ chat, messageCount: 3 }) } });
await expect.poll(() => calls.map(call => call.action)).toContain('reloadSettings');
```

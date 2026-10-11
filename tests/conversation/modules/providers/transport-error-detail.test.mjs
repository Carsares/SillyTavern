import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../../../../src/conversation/providers/chat/http.js';
import { createAuxiliaryAdapter } from '../../../../src/conversation/providers/auxiliary/index.js';

const secret = 'sk-test-secret-123';
const capability = { baseUrl: 'https://provider.invalid/v1' };
const connection = { apiKey: secret, headers: { 'X-Custom-Token': 'header-secret-value' } };

// Explicit errorDetail: undefined must reach createTransport, so it is spread rather than defaulted.
async function failure(body, { status = 400, signal, conn = connection, ...options } = {}) {
    const send = createTransport(conn, capability, { errorDetail: true, ...options, fetch: async () => body instanceof Response ? body : new Response(body, { status }) });
    const error = await send('generate', { body: { prompt: 'scene' }, signal }).then(() => assert.fail('must reject'), error => error);
    assert.equal(error.code, 'provider-http-error');
    return error.details;
}
const json = value => JSON.stringify(value);

test('errorDetail extracts the provider reason from common JSON shapes and plain text', async () => {
    for (const [body, expected] of [
        [json({ error: { message: 'Content policy violation', type: 'invalid_request_error' } }), 'Content policy violation'],
        [json({ message: 'Rate limited' }), 'Rate limited'],
        [json({ detail: 'Model not found' }), 'Model not found'],
        [json({ error: 'Invalid size' }), 'Invalid size'],
        [json({ error: { message: 'first' }, message: 'second', detail: 'third' }), 'first'],
        [json({ error: { message: '   ' }, message: 'second' }), 'second'],
        [json({ error: { code: 1 }, detail: 'third' }), 'third'],
        ['Bad gateway\n\n   from\tupstream\u0000 ', 'Bad gateway from upstream'],
    ]) {
        assert.deepEqual(await failure(body), { status: 400, retryable: false, providerMessage: expected });
    }
    for (const body of [json({ code: 42 }), json({ detail: [{ msg: 'structured' }] }), json(null), '', '  \n ']) {
        assert.deepEqual(await failure(body), { status: 400, retryable: false });
    }
    assert.deepEqual(await failure(json({ error: { message: 'Overloaded' } }), { status: 503 }), { status: 503, retryable: false, providerMessage: 'Overloaded' });
});

test('errorDetail redacts credentials echoed by the provider before truncation', async () => {
    const details = await failure(json({ error: { message: `Incorrect API key provided: ${secret}. Header header-secret-value rejected.` } }));
    assert.equal(details.providerMessage, 'Incorrect API key provided: [REDACTED]. Header [REDACTED] rejected.');
    // A secret straddling the 300-character boundary is redacted before it is cut.
    const straddling = await failure(`${'a'.repeat(290)} ${secret} tail`);
    assert.ok(!straddling.providerMessage.includes('sk-test')); assert.ok(straddling.providerMessage.startsWith(`${'a'.repeat(290)} [REDA`));
});

test('errorDetail truncates to 300 characters with an ellipsis', async () => {
    const details = await failure(json({ message: 'x'.repeat(500) }));
    assert.equal(details.providerMessage, `${'x'.repeat(300)}…`);
    const exact = await failure(json({ message: 'y'.repeat(300) }));
    assert.equal(exact.providerMessage, 'y'.repeat(300));
    const astral = await failure(json({ message: '😀'.repeat(400) }));
    assert.equal(Array.from(astral.providerMessage).length, 301);
});

test('errorDetail reads at most 4096 bytes of an endless body and releases it', { timeout: 5000 }, async () => {
    let pulls = 0, cancelled = false;
    const chunk = new TextEncoder().encode('word '.repeat(200));
    const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(chunk); }, cancel() { cancelled = true; } });
    const details = await failure(new Response(stream, { status: 400 }));
    assert.equal(details.providerMessage, `${'word '.repeat(60).trimEnd()}…`);
    assert.ok(pulls <= 7, `pulled ${pulls} chunks`); assert.equal(cancelled, true);
    // A credential cut by the 4096-byte cap cannot be matched by the redactor, so the cut token is dropped.
    const cut = await failure(`Denied:${' '.repeat(4080)}${secret} tail`);
    assert.equal(cut.providerMessage, 'Denied:…');
});

test('errorDetail never throws on body failures and stops reading on abort', { timeout: 5000 }, async () => {
    const errored = new ReadableStream({ pull(controller) { controller.error(new Error(`boom ${secret}`)); } });
    assert.deepEqual(await failure(new Response(errored, { status: 500 })), { status: 500, retryable: false });
    let cancelled = false;
    const stalled = new ReadableStream({ pull: () => new Promise(() => {}), cancel() { cancelled = true; } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    assert.deepEqual(await failure(new Response(stalled, { status: 502 }), { signal: controller.signal }), { status: 502, retryable: false });
    assert.equal(cancelled, true);
    const timed = new ReadableStream({ pull: () => new Promise(() => {}) });
    // AbortSignal.timeout is unref'd; keep the loop alive as a real server would.
    const hold = setInterval(() => {}, 1000);
    try { assert.deepEqual(await failure(new Response(timed, { status: 504 }), { conn: { ...connection, timeoutMs: 30 } }), { status: 504, retryable: false }); } finally { clearInterval(hold); }
});

test('errorDetail off keeps the existing details and cancels the body', async () => {
    for (const errorDetail of [false, undefined, 'true', 1]) {
        let cancelled = false;
        const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(json({ error: { message: 'hidden' } }))); }, cancel() { cancelled = true; } });
        const details = await failure(new Response(body, { status: 400 }), { errorDetail });
        assert.deepEqual(details, { status: 400, retryable: false }); assert.equal(cancelled, true);
    }
});

test('auxiliary adapter forwards errorDetail to image and absolute job URL transports', async () => {
    const image = createAuxiliaryAdapter({ provider: 'openai', type: 'image', model: 'gpt-image-1', baseUrl: 'https://provider.invalid/v1', apiKey: secret }, { errorDetail: true,
        fetch: async () => Response.json({ error: { message: `Your request was rejected by the safety system (key ${secret})` } }, { status: 400 }) });
    const error = await image.generateImage({ prompt: 'scene' }).then(() => assert.fail('must reject'), error => error);
    assert.equal(error.code, 'provider-http-error');
    assert.deepEqual(error.details, { status: 400, retryable: false, providerMessage: 'Your request was rejected by the safety system (key [REDACTED])', outcome: 'unknown', resubmit: false });
    const plain = createAuxiliaryAdapter({ provider: 'openai', type: 'image', model: 'gpt-image-1', baseUrl: 'https://provider.invalid/v1', apiKey: secret },
        { fetch: async () => Response.json({ error: { message: 'hidden' } }, { status: 400 }) });
    assert.equal((await plain.generateImage({ prompt: 'scene' }).catch(error => error)).details.providerMessage, undefined);
    const calls = [];
    const bfl = createAuxiliaryAdapter({ provider: 'bfl', type: 'image', model: 'flux-pro', baseUrl: 'https://api.bfl.ai/v1', maxPolls: 1, pollIntervalMs: 0, apiKey: secret }, { errorDetail: true, fetch: async request => {
        calls.push(request.url);
        return request.method === 'POST' ? Response.json({ id: 'job1', polling_url: 'https://api.us1.bfl.ai/v1/get_result?id=job1' }) : Response.json({ detail: 'Task not found' }, { status: 404 });
    } });
    const polled = await bfl.generateImage({ prompt: 'scene' }).then(() => assert.fail('must reject'), error => error);
    assert.equal(calls[1], 'https://api.us1.bfl.ai/v1/get_result?id=job1');
    assert.equal(polled.code, 'provider-http-error');
    assert.equal(polled.details.providerMessage, 'Task not found'); assert.equal(polled.details.status, 404); assert.equal(polled.details.outcome, 'unknown');
});

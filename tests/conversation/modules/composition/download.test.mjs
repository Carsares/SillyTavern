import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadImage } from '../../../../src/conversation/composition/download.js';
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('image downloads use fresh credential-free requests and pin checked DNS through redirects', async () => {
    const calls = [];
    const result = await downloadImage('https://cdn.example/a?signature=x', { lookup, fetch: async (request, { agent }) => {
        calls.push(request);
        assert.equal(request.credentials, 'omit');
        assert.equal(request.redirect, 'manual');
        assert.deepEqual([...request.headers.keys()], ['accept']);
        await new Promise((resolve, reject) => agent.options.lookup('cdn.example', {}, (error, address) => {
            if (error) reject(error); else { assert.equal(address, '93.184.216.34'); resolve(); }
        }));
        return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://other.example/result' } })
            : new Response(png, { headers: { 'content-type': 'image/png' } });
    } });
    assert.equal(calls.length, 2);
    assert.equal(result.base64, png.toString('base64'));
});

test('downloads block unsafe locations, MIME mismatch, oversized bodies and excess redirects', async () => {
    for (const url of ['http://example.com/a', 'https://user:secret@example.com/a', 'https://example.com:8443/a']) {
        await assert.rejects(downloadImage(url, { lookup, fetch: () => assert.fail('must not fetch') }));
    }
    await assert.rejects(downloadImage('https://localhost/a', { lookup: async () => [{ address: '127.0.0.1', family: 4 }], fetch: () => assert.fail('must not fetch') }));
    for (const response of [
        new Response(png, { headers: { 'content-type': 'image/svg+xml' } }),
        new Response('not a png', { headers: { 'content-type': 'image/png' } }),
        new Response(png, { headers: { 'content-type': 'image/png', 'content-length': '9000000' } }),
        new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }),
    ]) await assert.rejects(downloadImage('https://cdn.example/a', { lookup, fetch: async () => response }));
    let requests = 0;
    await assert.rejects(downloadImage('https://cdn.example/a', { lookup, fetch: async () => { requests++; return new Response(null, { status: 302, headers: { location: '/again' } }); } }));
    assert.equal(requests, 4);
});

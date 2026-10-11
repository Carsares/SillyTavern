import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../../../src/conversation/server.js';

export const IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

/** Local deterministic wire peer. Never forwards requests to the internet. */
export async function startFixture({ seed = true, settings = {} } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'conversation-integration-'));
    const captured = [];
    const provider = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { res.writeHead(400).end(); return; }
        captured.push({ path: req.url, body });
        if (req.url === '/v1/images/generations') {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ b64_json: IMAGE_BASE64 }] }));
            return;
        }
        if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
        const lastUser = [...body.messages].reverse().find(message => message.role === 'user');
        const text = typeof lastUser?.content === 'string' ? lastUser.content : lastUser?.content?.map(part => part.text ?? '').join('') ?? '';
        const chunk = delta => ({ id: 'local-response', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta, finish_reason: null }] });
        const write = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        write(chunk({ role: 'assistant', content: '' }));
        const summary = body.messages.some(message => message.role === 'system' && String(message.content).includes('Summarize only supported conversation facts'));
        if (summary) {
            write(chunk({ content: JSON.stringify({ chapter: 'Local chapter', rolling: 'Local rolling', memories: [{ op: 'create', kind: 'user-fact', content: 'Local remembered fact' }] }) }));
            write({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });
        } else if (text.includes('USE_TRACE') && !body.messages.some(message => message.role === 'tool')) {
            write(chunk({ tool_calls: [{ index: 0, id: 'trace-call', type: 'function', function: { name: 'recall_memory', arguments: JSON.stringify({ query: text }) } }] }));
            write({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });
        } else if (text.includes('USE_IMAGE') && !body.messages.some(message => message.role === 'tool')) {
            write(chunk({ tool_calls: [{ index: 0, id: 'image-call', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"Local pixel"}' } }] }));
            write({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });
        } else if (text.includes('USE_DICE') && !body.messages.some(message => message.role === 'tool')) {
            write(chunk({ tool_calls: [{ index: 0, id: 'dice-call', type: 'function', function: { name: 'roll_dice', arguments: '{"expr":"1d6"}' } }] }));
            write({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } });
        } else {
            write(chunk({ content: 'Local ' }));
            if (text.includes('WAIT_FOR_STOP')) {
                const timer = setTimeout(() => res.end(), 30000);
                res.once('close', () => clearTimeout(timer));
                return;
            }
            write(chunk({ content: body.messages.some(message => message.role === 'tool') ? 'dice completed' : 'answer' }));
            write({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 0 } } });
        }
        res.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    let application;
    try { application = await startServer({ port: 0, directory: join(root, 'conversation-v1') }); }
    catch (error) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await rm(root, { recursive: true, force: true }); throw error; }
    const url = `http://127.0.0.1:${application.address.port}`;
    const { token } = await (await fetch(`${url}/csrf-token`)).json();
    async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
        const response = await fetch(`${url}/api/conversation/v1${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, ...(body === undefined ? {} : { body: JSON.stringify({ schemaVersion: 1, ...body }) }) });
        const value = await response.json();
        return { status: response.status, value };
    }
    const connectionData = { provider: 'openai', executor: 'pi', type: 'chat', model: 'local-model', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'local-protocol-test-key', contextWindow: 131072, inputLimit: 131072, outputLimit: 4096, maxOutputTokens: 4096, workingBudget: 65536 };
    let connection, conversation;
    if (seed) {
        connection = (await api('/resources', { kind: 'connection', name: 'Local protocol connection', data: connectionData })).value;
        conversation = (await api('/conversations', { title: 'Isolated test', settings: { connectionId: connection.id, memoryFrequency: 1000, ...settings } })).value;
    }
    return { root, application, url, api, token, captured, connectionData, connection, conversation,
        async snapshot(id = conversation.id) { return (await api(`/conversations/${id}`)).value; },
        async send(content, extra = {}, id = conversation.id) {
            const snapshot = (await api(`/conversations/${id}`)).value;
            return api(`/conversations/${id}/turns`, { clientRequestId: randomUUID(), expectedContentRevision: snapshot.conversation.contentRevision, type: 'send', content, ...extra });
        },
        async wait(turnId) { return application.services.runtime.wait(turnId); },
        async close() { await application.close(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await rm(root, { recursive: true, force: true }); },
    };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResource, createResourceService } from '../../../../src/conversation/resources/index.js';
import { redact } from '../../../../src/conversation/traces/index.js';
import { createGroupScheduler } from '../../../../src/conversation/groups/index.js';

test('connection cannot override protected message/tool/auth/budget fields', () => {
    const data = { provider: 'custom', model: 'test', baseUrl: 'http://localhost:9999/v1', contextWindow: 8192, maxOutputTokens: 1024 };
    assert.doesNotThrow(() => validateResource({ kind: 'connection', name: 'local', data }));
    assert.throws(() => validateResource({ kind: 'connection', name: 'bad', data: { ...data, parameters: { messages: [] } } }), /managed/);
    assert.throws(() => validateResource({ kind: 'connection', name: 'bad', data: { ...data, headers: { Authorization: 'unsafe' } } }), /managed/);
    assert.throws(() => validateResource({ kind: 'connection', name: 'bad', data: { ...data, baseUrl: 'http://user:secret@localhost' } }), /credentials/);
});

test('editing public connection fields preserves write-only credential unless explicitly replaced', () => {
    let saved;
    const store = { getResource: () => ({ kind: 'connection' }), getConnection: () => ({ kind: 'connection', name: 'one', data: { apiKey: 'private', provider: 'custom', model: 'm' } }), updateResource(id, input) { saved = input; return {}; } };
    createResourceService({ store }).updateResource('c', { expectedRevision: 1, data: { provider: 'custom', model: 'new' } });
    assert.equal(saved.data.apiKey, 'private'); assert.equal(saved.data.model, 'new');
});

test('trace hides nested secrets, URL credentials and bearer values but keeps actual token usage', () => {
    const result = redact({ connection: { apiKey: 'private' }, headers: { Authorization: 'Bearer private' }, url: 'https://example.test?a=1&key=private', inputTokens: 13, outputTokens: null });
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(result.inputTokens, 13); assert.equal(result.outputTokens, null);
});

test('group selects frozen unique members and validates manual requests', () => {
    const snapshot = { settings: { groupId: 'g' }, messages: [], resources: [{ id: 'g', kind: 'group', data: { members: ['a', 'b'], mode: 'natural' } }, { id: 'a', kind: 'character', name: 'Alice' }, { id: 'b', kind: 'character', name: 'Bob' }] };
    const groups = createGroupScheduler({ id: () => 'run' });
    assert.deepEqual(groups.select(snapshot, { content: 'Hello Bob' }).map(member => member.characterId), ['b']);
    assert.throws(() => groups.select(snapshot, { members: ['c'] }), /belong/);
    assert.equal(groups.snapshot(snapshot, { characterId: 'a' }).resources.filter(resource => resource.kind === 'character').length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry } from '../../../../src/conversation/tools/index.js';
import { rollDice } from '../../../../src/conversation/tools/dice.js';
import { fakeStore } from '../memory/fake-store.mjs';
const call = (name, args = {}, toolCallId = 'call') => ({ conversationId: 'c', turnId: 'active', toolCallId, name, args });
test('default definitions disable writes/image and non-send generation tools', async () => {
    const registry = createToolRegistry({ store: fakeStore({ active: true }) });
    assert.deepEqual(registry.definitions({ type: 'send' }).map(d => d.name), ['recall_memory', 'search_lore', 'roll_dice', 'get_time']);
    assert.deepEqual(registry.definitions({ type: 'continue', enabled: ['get_time'] }), []);
    await assert.rejects(registry.execute(call('generate_image', { prompt: 'x' })), { code: 'tool-disabled' });
    await assert.rejects(registry.execute(call('shell', { command: 'ls' })), { code: 'tool-disabled' });
});
test('dice grammar is strict, bounded and never evaluates arbitrary expressions', () => {
    assert.equal(rollDice('2d6+3-d4', () => 0).total, 4);
    for (const expr of ['process.exit()', '1d6;foo()', '1d6*2', '0d6', '101d6', '2d1', '1d6/0', '1e3', '1d6++2', '', '100d6+1d6', '1 0d6', '1 d6']) assert.throws(() => rollDice(expr));
});
test('intent is persisted before dice, replay uses original random/time result and args cannot change', async () => {
    const store = fakeStore({ active: true }); let draws = 0;
    const registry = createToolRegistry({ store, random: () => { assert.equal([...store.tools.values()][0].status, 'intent'); draws++; return 0; }, now: () => 1700000000000 });
    const first = await registry.execute(call('roll_dice', { expr: '2d6' }));
    assert.deepEqual(await registry.execute(call('roll_dice', { expr: '2d6' })), first); assert.equal(draws, 2);
    await assert.rejects(registry.execute(call('roll_dice', { expr: '3d6' })), { code: 'idempotency-conflict' });
    const time = await registry.execute(call('get_time', {}, 'time')); assert.equal(time.timeZone, 'UTC');
    assert.deepEqual(await registry.execute(call('get_time', {}, 'time')), time);
});
test('tool calls are limited per round and per turn', async () => {
    const store = fakeStore({ active: true }); const registry = createToolRegistry({ store });
    for (let round = 1; round <= 5; round++) {
        registry.beginRound({ turnId: 'active', conversationId: 'c', round });
        for (let i = 0; i < 8; i++) await registry.execute(call('get_time', {}, `${round}:${i}`));
        await assert.rejects(registry.execute(call('get_time', {}, `${round}:overflow`)), { code: 'tool-limit' });
    }
    assert.throws(() => registry.beginRound({ turnId: 'active', conversationId: 'c', round: 6 }), { code: 'tool-limit' });
});
test('stopped turns and stale epoch cannot execute', async () => {
    const store = fakeStore({ active: true }); const registry = createToolRegistry({ store });
    await registry.execute(call('get_time')); store.turns.get('active').cancelRequested = true;
    await assert.rejects(registry.execute(call('get_time', {}, 'late')), { code: 'turn-inactive' });
});
test('memory update yields proposal without store writes; protects manual blocks', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['update_memory'] } });
    const registry = createToolRegistry({ store });
    const result = await registry.execute(call('update_memory', { block: { kind: 'world-state' }, op: 'create', content: 'new fact' }));
    assert.equal(result.status, 'proposed'); assert.equal(result.memoryProposal.kind, 'world-state');
    assert.equal(store.snapshot.memories.length, 0); assert.equal(store.commits.length, 0); assert.equal(registry.memoryProposals('active').length, 1);
    const other = fakeStore({ active: true, settings: { tools: ['update_memory'] } });
    other.snapshot.memories.push({ id: 'fixed', revision: 1, origin: 'manual', locked: false });
    await assert.rejects(createToolRegistry({ store: other }).execute(call('update_memory', { block: { id: 'fixed', expectedBlockRevision: 1 }, op: 'update', content: 'overwrite' })), { code: 'memory-protected' });
});
test('worldbook search only sees configured snapshot resources and retains entry revisions', async () => {
    const store = fakeStore({ active: true }); store.snapshot.resources.push({ id: 'book', revision: 3, kind: 'worldbook', data: { entries: [{ id: 'entry', content: 'dragon cave' }, { id: 'disabled', content: 'dragon', disabled: true }] } });
    const result = await createToolRegistry({ store }).execute(call('search_lore', { query: 'dragon' }));
    assert.equal(result.entries.length, 1); assert.deepEqual(result.entries[0].sourceRefs, [{ resourceId: 'book', revision: 3, entryId: 'entry' }]);
});
test('paid abort records unknown, concurrent replay joins, retry never sends again', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } }); const controller = new AbortController(); let calls = 0;
    const registry = createToolRegistry({ store, image: async () => { calls++; return new Promise(() => {}); } });
    const input = { ...call('generate_image', { prompt: 'dragon' }), signal: controller.signal };
    const first = registry.execute(input), second = registry.execute(input); controller.abort();
    await assert.rejects(first, { code: 'tool-result-unknown' }); await assert.rejects(second, { code: 'tool-result-unknown' });
    assert.equal([...store.tools.values()][0].status, 'unknown'); assert.equal(calls, 1);
    await assert.rejects(registry.execute(call('generate_image', { prompt: 'dragon' })), { code: 'tool-result-unknown' }); assert.equal(calls, 1);
});
test('persist full results and return a bounded reference', async () => {
    const store = fakeStore({ active: true }); const result = { entries: [{ content: '文'.repeat(30000) }] };
    const registry = createToolRegistry({ store, retrieval: { search: async () => result.entries } });
    const output = await registry.execute(call('recall_memory', { query: '文' }));
    assert.equal(output.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(output)) < 32768);
    assert.deepEqual(store.getTool(output.resultRef).result, result);
});
test('persisted intent after interruption never automatically reruns paid work', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    let reject;
    const registry = createToolRegistry({ store, image: () => new Promise((_, no) => { reject = no; }) });
    const running = registry.execute(call('generate_image', { prompt: 'x' }));
    const another = createToolRegistry({ store, image: () => assert.fail('cannot retry') });
    await assert.rejects(another.execute(call('generate_image', { prompt: 'x' })), { code: 'tool-result-unknown' });
    reject(new Error('network lost')); await assert.rejects(running, { code: 'tool-result-unknown' });
});
test('tool timeout is enforced even when injection ignores abort', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    const registry = createToolRegistry({ store, image: () => new Promise(() => {}) });
    const pending = registry.execute(call('generate_image', { prompt: 'x' }));
    t.mock.timers.tick(30001);
    await assert.rejects(pending, { code: 'tool-result-unknown' });
    assert.equal([...store.tools.values()][0].status, 'unknown');
});
test('missing image injection is a definite failure, not a paid unknown', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    await assert.rejects(createToolRegistry({ store }).execute(call('generate_image', { prompt: 'x' })), { code: 'tool-unavailable' });
    assert.equal([...store.tools.values()][0].status, 'failed');
});
test('explicit frozen snapshot and assembled worldbook entries are honored', async () => {
    const store = fakeStore({ active: true });
    store.snapshot.resources = [{ id: 'book', kind: 'worldbook', revision: 1, data: { entries: [{ id: 'used', content: 'dragon used' }, { id: 'unused', content: 'dragon frozen' }] } }];
    const frozen = store.getConversation(); store.snapshot.resources[0].revision = 2; store.snapshot.resources[0].data.entries[1].content = 'dragon changed';
    const registry = createToolRegistry({ store }); registry.bindTurn({ turnId: 'active', snapshot: frozen, requestPlan: { blocks: [{ worldKey: 'book:used' }] } });
    const result = await registry.execute(call('search_lore', { query: 'dragon' }));
    assert.equal(result.entries.length, 1); assert.equal(result.entries[0].content, 'dragon frozen'); assert.equal(result.entries[0].sourceRefs[0].revision, 1);
});
test('escaped result previews stay within serialized byte limit', async () => {
    const store = fakeStore({ active: true }); const registry = createToolRegistry({ store, retrieval: { search: async () => [{ content: '\u0000'.repeat(50000) }] } });
    const result = await registry.execute(call('recall_memory', { query: 'x' })); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
});
test('frozen per-session lower round/call limits override defaults and replay consumes no extra slot', async () => {
    const store = fakeStore({ active: true, settings: { toolLimits: { rounds: 2, callsPerRound: 1 } } });
    const registry = createToolRegistry({ store }); registry.bindTurn({ turnId: 'active', snapshot: store.getConversation() });
    store.snapshot.settings.toolLimits = { rounds: 5, callsPerRound: 8 };
    await registry.execute(call('get_time', {}, 'first'));
    await registry.execute(call('get_time', {}, 'first'));
    await assert.rejects(registry.execute(call('get_time', {}, 'overflow')), { code: 'tool-limit' });
    registry.beginRound({ turnId: 'active', conversationId: 'c', round: 2 });
    await registry.execute(call('get_time', {}, 'second'));
    assert.throws(() => registry.beginRound({ turnId: 'active', conversationId: 'c', round: 3 }), { code: 'tool-limit' });
});
test('invalid limits fail before recording intent or invoking tools', async () => {
    for (const toolLimits of [null, [], 3, { rounds: 0 }, { rounds: -1 }, { rounds: 1.5 }, { rounds: 6 }, { callsPerRound: 9 }, { timeoutMs: 30001 },
        { turnTimeoutMs: 180001 }, { resultBytes: 32769 }, { resultBytes: Infinity }, { rounds: '1' }, { typo: 1 }]) {
        const store = fakeStore({ active: true, settings: { toolLimits } });
        await assert.rejects(createToolRegistry({ store }).execute(call('get_time')), { code: 'invalid-tool-limits' });
        assert.equal(store.tools.size, 0);
    }
});
test('configured lower resultBytes applies to new and replayed results', async () => {
    const store = fakeStore({ active: true, settings: { toolLimits: { resultBytes: 160 } } });
    const registry = createToolRegistry({ store, retrieval: { search: async () => [{ content: '大'.repeat(1000) }] } });
    const first = await registry.execute(call('recall_memory', { query: 'x' }));
    assert.ok(first.truncated); assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 160);
    assert.equal(store.getTool(first.resultRef).result.entries[0].content.length, 1000);
    assert.deepEqual(await registry.execute(call('recall_memory', { query: 'x' })), first);
});
test('tiny positive result limit terminates explicitly instead of looping on an oversized reference', async () => {
    const store = fakeStore({ active: true, settings: { toolLimits: { resultBytes: 1 } } });
    const registry = createToolRegistry({ store });
    await assert.rejects(registry.execute(call('get_time')), { code: 'tool-result-limit' });
    assert.equal([...store.tools.values()][0].status, 'completed');
    await assert.rejects(registry.execute(call('get_time')), { code: 'tool-result-limit' });
});
test('lower timeoutMs cancels waiting and passes abort to the injected tool', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = fakeStore({ active: true, settings: { toolLimits: { timeoutMs: 10 } } }); let signal;
    const registry = createToolRegistry({ store, retrieval: { search: (_cid, _query, options) => { signal = options.signal; return new Promise(() => {}); } } });
    const pending = registry.execute(call('recall_memory', { query: 'x' }));
    t.mock.timers.tick(9); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await assert.rejects(pending, { code: 'tool-timeout' }); assert.equal(signal.aborted, true);
});
test('group rebind updates member context but retains turn limits, rounds, counts and start time', async () => {
    let time = 0;
    const store = fakeStore({ active: true, settings: { toolLimits: { callsPerRound: 2, rounds: 2, turnTimeoutMs: 100 } } });
    store.turns.get('active').type = 'group';
    const registry = createToolRegistry({ store, now: () => time });
    registry.bindTurn({ turnId: 'active', snapshot: store.getConversation() });
    await registry.execute({ ...call('get_time', {}, 'member-a'), memberRunId: 'a' });
    const memberB = store.getConversation();
    memberB.settings.timeZone = 'Asia/Tokyo'; memberB.settings.toolLimits = { callsPerRound: 8, rounds: 5, turnTimeoutMs: 1000 };
    time = 50; registry.bindTurn({ turnId: 'active', snapshot: memberB });
    const result = await registry.execute({ ...call('get_time', {}, 'member-b'), memberRunId: 'b' }); assert.equal(result.timeZone, 'Asia/Tokyo');
    await assert.rejects(registry.execute({ ...call('get_time', {}, 'member-overflow'), memberRunId: 'b' }), { code: 'tool-limit' });
    registry.beginRound({ turnId: 'active', conversationId: 'c', round: 2 });
    registry.bindTurn({ turnId: 'active', snapshot: memberB });
    assert.throws(() => registry.beginRound({ turnId: 'active', conversationId: 'c', round: 1 }), { code: 'tool-limit' });
    assert.throws(() => registry.beginRound({ turnId: 'active', conversationId: 'c', round: 3 }), { code: 'tool-limit' });
    time = 100;
    await assert.rejects(registry.execute(call('get_time', {}, 'deadline')), { code: 'tool-limit' });
});
test('pending call is bounded by remaining configured turn timeout after group rebind', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); let time = 0, signal;
    const store = fakeStore({ active: true, settings: { toolLimits: { turnTimeoutMs: 20, timeoutMs: 100 } } });
    const registry = createToolRegistry({ store, now: () => time, retrieval: { search: (_cid, _query, options) => { signal = options.signal; return new Promise(() => {}); } } });
    registry.bindTurn({ turnId: 'active', snapshot: store.getConversation() });
    time = 15; registry.bindTurn({ turnId: 'active', snapshot: store.getConversation() });
    const pending = registry.execute(call('recall_memory', { query: 'x' }));
    t.mock.timers.tick(4); assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); await assert.rejects(pending, { code: 'tool-timeout' });
});

test('toolArtifacts collects only registered images using authoritative safe metadata', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    const registered = new Map([['image-1', { id: 'image-1', mime: 'image/png', name: 'safe.png', size: 4, path: 'private-file' }], ['audio-1', { id: 'audio-1', mime: 'audio/wav', name: 'audio', size: 4 }]]);
    store.getAttachment = id => registered.get(id);
    const registry = createToolRegistry({ store, image: async input => {
        assert.equal(input.recordId, input.idempotencyKey); assert.equal(input.snapshot.conversationId, 'c');
        return { images: [{ id: 'image-1', mime: 'wrong', name: 'wrong', size: 999 }, { attachmentId: 'image-1' }, { id: 'missing' }, { id: 'audio-1' },
            { url: 'https://external.invalid/image' }, { externalURL: 'https://external.invalid/image', id: 'image-1' }] };
    } });
    assert.deepEqual(registry.toolArtifacts('active'), []);
    await registry.execute(call('generate_image', { prompt: 'x' }));
    const expected = [{ type: 'image', attachmentId: 'image-1', mimeType: 'image/png', name: 'safe.png', size: 4 }];
    assert.deepEqual(registry.toolArtifacts('active'), expected);
    registry.toolArtifacts('active')[0].name = 'mutated'; assert.deepEqual(registry.toolArtifacts('active'), expected);
    registered.delete('image-1'); assert.deepEqual(registry.toolArtifacts('active'), []);
});

test('group artifacts filter by member while replay and rebind retain completed references', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    store.turns.get('active').type = 'group';
    store.getAttachment = id => ({ id, mime: 'image/png', name: id, size: 1 });
    let calls = 0;
    const registry = createToolRegistry({ store, image: async input => { calls++; return { images: [{ id: `image-${input.memberRunId}` }] }; } });
    for (const memberRunId of ['a', 'b']) {
        registry.bindTurn({ turnId: 'active', snapshot: store.getConversation() });
        await registry.execute({ ...call('generate_image', { prompt: 'x' }), memberRunId });
        assert.deepEqual(registry.toolArtifacts('active', memberRunId).map(x => x.attachmentId), [`image-${memberRunId}`]);
    }
    assert.equal(registry.toolArtifacts('active').length, 2);
    assert.deepEqual(registry.toolArtifacts('active', 'missing'), []);
    await registry.execute({ ...call('generate_image', { prompt: 'x' }), memberRunId: 'b' }); assert.equal(calls, 2);
    const recovered = createToolRegistry({ store, image: () => assert.fail('never regenerate completed artifact') });
    await recovered.execute({ ...call('generate_image', { prompt: 'x' }), memberRunId: 'a' });
    assert.equal(recovered.toolArtifacts('active', 'a')[0].attachmentId, 'image-a');
    assert.deepEqual(recovered.toolArtifacts('active', 'b'), []);
    registry.release('active'); assert.deepEqual(registry.toolArtifacts('active'), []);
});

test('unknown or late image output never becomes an assistant artifact and is not retried', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    store.getAttachment = id => ({ id, mime: 'image/png', name: id, size: 1 });
    let resolve, calls = 0;
    const registry = createToolRegistry({ store, image: () => { calls++; return new Promise(yes => { resolve = yes; }); } });
    const controller = new AbortController(), promise = registry.execute({ ...call('generate_image', { prompt: 'x' }), signal: controller.signal });
    controller.abort(); await assert.rejects(promise, { code: 'tool-result-unknown' });
    resolve({ images: [{ id: 'late-image' }] }); await Promise.resolve();
    assert.deepEqual(registry.toolArtifacts('active'), []);
    await assert.rejects(registry.execute(call('generate_image', { prompt: 'x' })), { code: 'tool-result-unknown' }); assert.equal(calls, 1);
});

test('oversized image result still exposes registered artifacts from the full durable record', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'], toolLimits: { resultBytes: 160 } } });
    store.getAttachment = id => ({ id, mime: 'image/webp', name: 'only-image', size: 1 });
    const registry = createToolRegistry({ store, image: async () => ({ images: [{ id: 'generated' }], detail: 'x'.repeat(1000) }) });
    const result = await registry.execute(call('generate_image', { prompt: 'x' })); assert.equal(result.truncated, true);
    assert.deepEqual(registry.toolArtifacts('active').map(x => x.attachmentId), ['generated']);
});

test('paid unknown is fatal, notifies runtime and blocks subsequent calls even with fresh IDs', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image', 'get_time'] } });
    let notified, requests = 0;
    const tools = createToolRegistry({ store, image: async () => { requests++; throw Error('uncertain'); } });
    tools.bindTurn({ turnId: 'active', snapshot: store.getConversation(), onFatal: error => { notified = error; } });
    await assert.rejects(tools.execute(call('generate_image', { prompt: 'x' })), { code: 'tool-result-unknown', fatal: true, retryable: false });
    assert.equal(tools.fatalError('active'), notified);
    await assert.rejects(tools.execute(call('get_time', {}, 'next')), { fatal: true });
    assert.equal(requests, 1); assert.equal(store.tools.size, 1);
});

test('retry ancestor unknown matches original member identity and never resubmits', async () => {
    for (const same of [true, false]) {
        const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
        const current = store.turns.get('active');
        current.request = { retryTurnId: 'older' }; current.plannedMembers = [{ id: 'new-member', characterId: 'alice' }];
        store.turns.set('older', { id: 'older', conversationId: 'c', plannedMembers: [{ id: 'old-member', characterId: same ? 'alice' : 'bob' }] });
        store.tools.set('old-image', { id: 'old-image', conversationId: 'c', turnId: 'older', memberRunId: 'old-member', name: 'generate_image', args: { prompt: 'x' }, status: 'unknown' });
        let requests = 0;
        const tools = createToolRegistry({ store, image: async () => { requests++; return { images: [] }; } });
        const task = tools.execute({ ...call('generate_image', { prompt: 'x' }, 'fresh'), memberRunId: 'new-member' });
        if (same) { await assert.rejects(task, { code: 'tool-result-unknown', fatal: true }); assert.equal(requests, 0); assert.equal(store.tools.size, 1); }
        else { await task; assert.equal(requests, 1); }
    }
});

test('image recovery exposes only durable job record and never permits missing-handle submission', () => {
    const store = fakeStore();
    store.tools.set('image', { id: 'image', conversationId: 'c', turnId: 'old', name: 'generate_image', status: 'unknown' });
    const tools = createToolRegistry({ store });
    assert.equal(tools.imageRecovery('c', 'image').blockedReason, 'provider-job-handle-missing');
    store.jobs.set('job', { id: 'job', conversationId: 'c', kind: 'provider-request', dependencies: { origin: 'image' }, payload: { jobId: 'opaque-secret-provider-handle', state: 'unknown' } });
    const recovery = tools.imageRecovery('c', 'image');
    assert.equal(recovery.canResume, true); assert.equal(recovery.jobRecordId, 'job'); assert.equal(recovery.resubmitAllowed, false);
    assert.ok(!JSON.stringify(recovery).includes('opaque-secret'));
    assert.throws(() => tools.imageRecovery('different', 'image'), { code: 'invalid-tool' });
});

test('image retry fails closed without persisted history port before intent or provider call', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    delete store.listTools;
    store.turns.get('active').request = { retryTurnId: 'old' };
    const tools = createToolRegistry({ store, image: () => assert.fail('must not submit') });
    await assert.rejects(tools.execute(call('generate_image', { prompt: 'x' })), { code: 'tool-retry-history-unavailable', fatal: true });
    assert.equal(store.tools.size, 0);
});

test('domain unknown remains fatal even when an injection incorrectly labels it definitive', async () => {
    const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
    const tools = createToolRegistry({ store, image: async () => { throw Object.assign(Error(), { code: 'provider-job-unknown', definitive: true }); } });
    await assert.rejects(tools.execute(call('generate_image', { prompt: 'x' })), { code: 'tool-result-unknown', fatal: true });
    assert.equal([...store.tools.values()][0].status, 'unknown');
});

test('manually recovered ancestor image is reused across retry chain without new charge or old-message changes', async () => {
    for (const group of [false, true]) {
        const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
        const active = store.turns.get('active');
        active.request = { retryTurnId: 'middle' };
        if (group) active.plannedMembers = [{ id: 'new-member', characterId: 'alice' }];
        store.turns.set('middle', { id: 'middle', conversationId: 'c', request: { retryTurnId: 'original' } });
        store.turns.set('original', { id: 'original', conversationId: 'c', ...(group ? { plannedMembers: [{ id: 'old-member', characterId: 'alice' }] } : {}) });
        const historical = { id: 'recovered', conversationId: 'c', turnId: 'original', ...(group ? { memberRunId: 'old-member' } : {}),
            name: 'generate_image', args: { prompt: 'x' }, status: 'completed', result: { images: [{ id: 'img' }], usage: { cost: 5, complete: true } } };
        store.tools.set(historical.id, structuredClone(historical));
        store.getAttachment = id => ({ id, mime: 'image/png', name: 'restored.png', size: 8 });
        const beforeMessages = structuredClone(store.snapshot.messages);
        let paid = 0;
        const registry = createToolRegistry({ store, image: () => { paid++; assert.fail('No new paid submission'); } });
        const input = { ...call('generate_image', { prompt: 'x' }, 'retry-call'), ...(group ? { memberRunId: 'new-member' } : {}) };
        const result = await registry.execute(input);
        assert.equal(result.reusedFromToolId, 'recovered'); assert.deepEqual(result.usage, { cost: 0, complete: true });
        assert.deepEqual(await registry.execute(input), result);
        assert.equal(paid, 0); assert.equal(store.tools.size, 2);
        assert.deepEqual(store.tools.get('recovered'), historical); assert.deepEqual(store.snapshot.messages, beforeMessages);
        assert.equal(registry.toolArtifacts('active', group ? 'new-member' : undefined)[0].attachmentId, 'img');
        if (group) assert.deepEqual(registry.toolArtifacts('active', 'other-member'), []);
        registry.release('active');
        const restarted = createToolRegistry({ store, image: () => assert.fail('Recovered replay must survive restart') });
        assert.deepEqual(await restarted.execute(input), result);
    }
});

test('completed retry image with missing cached result or uncertain member identity blocks instead of charging', async () => {
    for (const missingResult of [false, true]) {
        const store = fakeStore({ active: true, settings: { tools: ['generate_image'] } });
        store.turns.get('active').request = { retryTurnId: 'original' };
        store.turns.set('original', { id: 'original', conversationId: 'c' });
        store.tools.set('completed', { id: 'completed', turnId: 'original', conversationId: 'c', name: 'generate_image', args: { prompt: 'x' }, status: 'completed',
            ...(missingResult ? {} : { memberRunId: 'other-run', result: { images: [{ id: 'img' }] } }) });
        const registry = createToolRegistry({ store, image: () => assert.fail('Must not charge') });
        await assert.rejects(registry.execute({ ...call('generate_image', { prompt: 'x' }), ...(missingResult ? {} : { memberRunId: 'new-run' }) }),
            { fatal: true, code: missingResult ? 'tool-result-unknown' : 'tool-retry-identity-unknown' });
        assert.equal(store.tools.size, 1);
    }
});

test('tool sessions require the frozen turn snapshot and only read canonical timeZone', async () => {
    const store = fakeStore({ active: true });
    const frozen = store.getConversation(); frozen.settings.timeZone = 'Asia/Tokyo';
    let reads = 0;
    store.getTurnSnapshot = turnId => { assert.equal(turnId, 'active'); reads++; return structuredClone(frozen); };
    store.snapshot.settings.timeZone = 'America/New_York';
    const registry = createToolRegistry({ store });
    assert.equal((await registry.execute(call('get_time'))).timeZone, 'Asia/Tokyo');
    assert.equal(reads, 1);
    const oldShape = fakeStore({ active: true, settings: { timezone: 'Asia/Tokyo' } });
    assert.equal((await createToolRegistry({ store: oldShape }).execute(call('get_time'))).timeZone, 'UTC');
});

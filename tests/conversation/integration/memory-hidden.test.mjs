import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from './fixture.mjs';

test('HTTP compaction never sends user-hidden raw text or dependent memory/summary to auxiliary provider', async t => {
    const app = await startFixture({ settings: { tools: [] } }); t.after(() => app.close());
    for (const content of ['PRIVATE_HIDDEN_SENTINEL', 'Visible later fact.', 'Newest visible fact.']) {
        const response = await app.send(content); assert.equal(response.status, 202);
        assert.equal((await app.wait(response.value.turnId)).status, 'completed');
    }
    const compact = async () => {
        const snapshot = await app.snapshot();
        return app.api(`/conversations/${app.conversation.id}/compact`, {
            expectedContentRevision: snapshot.conversation.contentRevision,
            expectedMemoryRevision: snapshot.conversation.memoryRevision,
        });
    };
    assert.equal((await compact()).status, 200);
    const before = await app.snapshot();
    assert.ok(before.summaries.length && before.memories.length);
    const hidden = before.messages.find(m => m.content === 'PRIVATE_HIDDEN_SENTINEL');
    assert.equal((await app.api(`/conversations/${app.conversation.id}/commands`, {
        type: 'message.hide', messageId: hidden.id, hidden: true,
        expectedContentRevision: before.conversation.contentRevision,
    })).status, 200);
    const offset = app.captured.length;
    const response = await compact(); assert.equal(response.status, 200, JSON.stringify(response.value));
    const requests = app.captured.slice(offset).filter(item => item.body.messages?.some(m =>
        m.role === 'system' && String(m.content).includes('Summarize only supported conversation facts')));
    assert.equal(requests.length, 1);
    const wire = JSON.stringify(requests[0].body);
    for (const excluded of ['PRIVATE_HIDDEN_SENTINEL', 'Local chapter', 'Local rolling', 'Local remembered fact'])
        assert.equal(wire.includes(excluded), false, `Auxiliary request contains excluded content: ${excluded}`);
    const after = await app.snapshot();
    assert.equal(after.messages.find(m => m.id === hidden.id).userHidden, true);
    assert.equal(after.messages.find(m => m.id === hidden.id).content, 'PRIVATE_HIDDEN_SENTINEL');
    const priorIds = new Set([...before.summaries, ...before.memories].map(block => block.id));
    for (const block of [...after.summaries, ...after.memories].filter(block => !priorIds.has(block.id)))
        assert.ok(block.sourceRefs.every(ref => ref.messageId !== hidden.id));
});

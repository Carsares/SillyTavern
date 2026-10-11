import test from 'node:test';
import assert from 'node:assert/strict';
import { compileContext } from '../../../../public/shared/conversation/assembly/index.js';
import { sourceRef } from '../../../../public/shared/conversation/schemas/index.js';

const capabilities = { contextWindow: 8192, maxOutputTokens: 512, workingBudget: 4096 };
const message = (id, role, content, turnId) => ({ id, role, content, turnId, revision: 1, candidateId: null, candidateRevision: null, status: 'completed' });
const snapshot = () => ({ conversation: { settings: {} }, settings: {}, resources: [], messages: [message('u', 'user', 'Name the city', 'one'), message('a', 'assistant', 'OLD ANSWER', 'one'), message('later', 'user', 'FUTURE INFO', 'two')], summaries: [], memories: [], folds: [] });

test('regeneration excludes target answer and following history from model input', () => {
    const result = compileContext(snapshot(), { type: 'regenerate', targetMessageId: 'a', capabilities });
    assert.equal(JSON.stringify(result.messages).includes('OLD ANSWER'), false);
    assert.equal(JSON.stringify(result.messages).includes('FUTURE INFO'), false);
    assert.ok(JSON.stringify(result.messages).includes('Name the city'));
});

test('continuation keeps its target but excludes later history', () => {
    const result = compileContext(snapshot(), { type: 'continue', targetMessageId: 'a', capabilities });
    assert.ok(JSON.stringify(result.messages).includes('OLD ANSWER'));
    assert.equal(JSON.stringify(result.messages).includes('FUTURE INFO'), false);
});

test('valid structured memory is included even when its evidence remains in raw history', () => {
    const value = snapshot();
    value.memories = [{ id: 'fact', revision: 1, content: 'Remember the user preference', sourceRefs: [sourceRef(value.messages[0])], status: 'valid', locked: true }];
    const result = compileContext(value, { capabilities });
    assert.ok(result.blocks.some(block => block.id === 'derived:fact' && block.layer === 'L2'));
    assert.ok(result.blocks.some(block => block.id === 'history:u'));
});

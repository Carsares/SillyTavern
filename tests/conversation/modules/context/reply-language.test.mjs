import test from 'node:test';
import assert from 'node:assert/strict';
import { compileContext } from '../../../../public/shared/conversation/assembly/index.js';

const capabilities = { contextWindow: 8192, maxOutputTokens: 512, workingBudget: 4096 };
const message = (id, role, content, turnId) => ({ id, role, content, turnId, revision: 1, candidateId: null, candidateRevision: null, status: 'completed' });
const snapshot = settings => ({ conversation: { settings: {} }, settings, resources: [], messages: [message('u1', 'user', 'Hello there', 'one'), message('a1', 'assistant', 'Greetings, traveler', 'one'), message('u2', 'user', '你好', 'two')], summaries: [], memories: [], folds: [] });
const texts = result => result.messages.map(item => JSON.stringify(item.content));

test('the reply language is placed after the whole chat history', () => {
    const result = compileContext(snapshot({ replyLanguage: 'zh-CN' }), { capabilities });
    const block = result.blocks.find(item => item.id === 'runtime:reply-language');
    assert.equal(block?.layer, 'L5');
    assert.match(String(block.content), /Simplified Chinese/);
    const all = texts(result);
    const instruction = all.findIndex(text => text.includes('Simplified Chinese'));
    const lastHistory = all.findIndex(text => text.includes('你好'));
    assert.ok(instruction > lastHistory, 'instruction comes after the latest user message');
});

test('no reply language block without the setting, for "no preference", or for auxiliary tasks', () => {
    for (const [settings, options] of [[{}, {}], [{ replyLanguage: '' }, {}], [{ replyLanguage: 'zh-CN' }, { type: 'auxiliary' }]]) {
        const result = compileContext(snapshot(settings), { capabilities, ...options });
        assert.equal(result.blocks.some(item => item.id === 'runtime:reply-language'), false);
    }
});

test('"follow" asks for the language of the latest user message', () => {
    const result = compileContext(snapshot({ replyLanguage: 'follow' }), { capabilities });
    assert.match(String(result.blocks.find(item => item.id === 'runtime:reply-language')?.content), /same language as the user's latest message/);
});

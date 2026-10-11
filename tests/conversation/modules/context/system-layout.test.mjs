import test from 'node:test';
import assert from 'node:assert/strict';
import { compileContext } from '../../../../public/shared/conversation/assembly/index.js';
import { getChatCapabilities } from '../../../../src/conversation/capabilities/chat/index.js';
import { getCapabilities as getPiCapabilities, validateCapabilities } from '../../../../src/conversation/capabilities/core/index.js';
import { encodeChat } from '../../../../src/conversation/providers/chat/protocol.js';
import { createClaudeExecutor } from '../../../../src/conversation/executors/claude/index.js';
import { createCodexExecutor } from '../../../../src/conversation/executors/codex/index.js';
import { createTranscript, expandTranscript } from '../../../../src/conversation/executors/sdk-gateway/history.js';

const budget = { contextWindow: 32000, maxOutputTokens: 1000, workingBudget: 16000 };
const native = provider => { const c = { provider, executor: 'pi', model: 'synthetic-model', apiKey: 'synthetic-key', ...budget }; return { c, capability: validateCapabilities(c, getChatCapabilities(c)) }; };
const sdkConnection = { model: 'synthetic-model', baseUrl: 'https://provider.invalid/v1', ...budget };
const sdk = factory => factory({ environmentFactory: () => ({}) }).getCapabilities(sdkConnection);
const message = (id, role, turnId) => ({ id, role, content: `${id} text`, turnId, revision: 1, status: 'completed' });
// Ten complete turns so the depth block lands inside history, plus tail and generation-type instructions.
const snapshot = () => ({ conversation: { settings: {} }, settings: { connectionId: 'c', presetId: 'p', characterId: 'ch' },
    messages: Array.from({ length: 10 }, (_, index) => [message(`u${index}`, 'user', `t${index}`), message(`a${index}`, 'assistant', `t${index}`)]).flat(),
    resources: [{ id: 'c', kind: 'connection', revision: 1, data: budget }, { id: 'ch', kind: 'character', name: 'Ada', revision: 1, data: { description: 'Character card' } },
        { id: 'p', kind: 'preset', revision: 1, data: { system: 'Preset rules', blocks: [
            { id: 'depth-note', role: 'system', placement: { type: 'depth', depth: 3 }, content: 'Depth note' },
            { id: 'post-history', role: 'system', placement: { type: 'tail' }, content: 'Post-history rule' }] } }],
    summaries: [], memories: [], folds: [] });
const instructions = { regenerate: /new alternative assistant reply/, continue: /Continue the last assistant message/, impersonate: /as the user persona/, auxiliary: /auxiliary task/ };
const compile = (type, capabilities) => compileContext(snapshot(), { type, targetMessageId: 'a9', capabilities });
const systemAfterConversation = messages => messages.findIndex((item, index) => item.role === 'system' && messages.slice(0, index).some(previous => previous.role !== 'system'));

for (const [name, capabilities, encode] of [
    ['anthropic Pi', () => native('anthropic').capability, plan => encodeChat(native('anthropic').c, native('anthropic').capability, { messages: plan.messages, maxOutputTokens: 100 }, {})],
    ['google Pi', () => native('google').capability, plan => encodeChat(native('google').c, native('google').capability, { messages: plan.messages, maxOutputTokens: 100 }, {})],
    ['Claude SDK', () => sdk(createClaudeExecutor), plan => {
        const transcript = createTranscript({ id: 'snapshot' }, plan);
        return expandTranscript({ model: 'synthetic-model', system: 'sdk prompt', messages: [{ role: 'user', content: transcript.prompt }] }, 'anthropic', transcript);
    }],
]) test(`${name}: regenerate/continue/impersonate/auxiliary keep system text only as a prefix`, () => {
    const capability = capabilities();
    assert.equal(capability.supported, true);
    for (const type of Object.keys(instructions)) {
        // The previous layout put tail/depth system blocks after history, which this codec rejects.
        assert.throws(() => encode(compile(type, { ...capability, systemPlacement: 'any', deepSystem: true })), { code: /^unsupported-(system-placement|deep-system)$/ });
        const plan = compile(type, capability);
        assert.equal(systemAfterConversation(plan.messages), -1);
        assert.deepEqual(plan.messages.filter(item => item.role === 'system').map(item => item.content), ['Character card', 'Preset rules']);
        const last = plan.messages.at(-1);
        assert.equal(last.role, 'user'); assert.match(last.content, instructions[type]);
        assert.deepEqual(plan.messages.at(-2), { role: 'user', content: 'Post-history rule' });
        assert.equal(plan.messages.at(-3).role, type === 'regenerate' ? 'user' : 'assistant');
        if (type === 'continue') assert.equal(plan.messages.at(-3).content, 'a9 text');
        // Depth 3 stays three turns from the end; only the sent role changes.
        const depth = plan.blocks.find(block => block.id === 'depth-note');
        assert.equal(depth.role, 'system'); assert.equal(depth.message.role, 'user');
        assert.equal(plan.messages[plan.blocks.indexOf(depth) + 1].content, 'u7 text');
        const encoded = encode(plan);
        const system = encoded.systemInstruction?.parts ?? encoded.system;
        assert.deepEqual(system.map(part => part.text), ['Character card', 'Preset rules']);
        const sent = encoded.contents ?? encoded.messages;
        assert.equal(sent.at(-1).role, 'user');
        assert.match((sent.at(-1).parts ?? sent.at(-1).content)[0].text, instructions[type]);
    }
});

test('prefix-only layout converts late system history while any-placement layouts stay unchanged', () => {
    const value = snapshot();
    value.messages.splice(4, 0, { ...message('narrator', 'system', 'narration'), content: 'Narrator line' });
    const prefix = compileContext(value, { capabilities: native('anthropic').capability });
    assert.equal(systemAfterConversation(prefix.messages), -1);
    assert.deepEqual(prefix.messages.find(item => item.content === 'Narrator line'), { role: 'user', content: 'Narrator line' });
    for (const type of Object.keys(instructions)) {
        const baseline = compileContext(snapshot(), { type, targetMessageId: 'a9', capabilities: budget });
        for (const capability of [native('openai').capability, getPiCapabilities({ provider: 'openai', executor: 'pi', model: 'synthetic-model', baseUrl: 'https://provider.invalid/v1', ...budget }), sdk(createCodexExecutor)]) {
            assert.equal(capability.supported, true);
            const plan = compile(type, capability);
            assert.deepEqual(plan.messages, baseline.messages);
            assert.equal(plan.messages.at(-1).role, 'system');
            assert.equal(plan.blocks.find(block => block.id === 'depth-note').message.role, 'system');
        }
    }
});

test('memory compression auxiliary plan keeps its instruction for prefix-only providers', () => {
    const capability = native('anthropic').capability;
    const plan = compileContext({ conversation: { settings: {} }, settings: { presetId: 'memory' }, resources: [{ id: 'memory', kind: 'preset', data: { system: 'Summarize facts' } }],
        messages: [{ id: 'memory-input', role: 'user', revision: 1, turnId: 'memory-input', status: 'completed', content: '{"messages":[]}' }], summaries: [], memories: [], folds: [] }, { type: 'auxiliary', capabilities: capability });
    assert.deepEqual(plan.messages.map(item => item.role), ['system', 'user', 'user']);
    const body = encodeChat(native('anthropic').c, capability, { messages: plan.messages, maxOutputTokens: 100 }, {});
    assert.deepEqual(body.system, [{ type: 'text', text: 'Summarize facts' }]);
    assert.match(body.messages.at(-1).content[0].text, instructions.auxiliary);
});

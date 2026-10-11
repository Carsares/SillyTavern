import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight, historyInstructions } from '../../../../src/conversation/executors/sdk-gateway/contracts.js';
import { reasoningControls, REASONING_LEVELS } from '../../../../src/conversation/executors/sdk-gateway/reasoning.js';
import { createSdkGateway } from '../../../../src/conversation/executors/sdk-gateway/index.js';
import { createTranscript } from '../../../../src/conversation/executors/sdk-gateway/history.js';

const connection = { model: 'test', baseUrl: 'https://test.invalid/v1', contextWindow: 16000, workingBudget: 8000, maxOutputTokens: 4096 };

for (const executor of ['claude', 'codex']) {
    test(`${executor}: declared public effort levels map to SDK options and actual outbound JSON`, async t => {
        for (const level of REASONING_LEVELS[executor]) {
            const controls = reasoningControls(executor, level, 4096);
            const c = { ...connection, reasoning: level };
            assert.equal(preflight(executor, { connection: c }).reasoning.modelSupportVerified, false);
            if (executor === 'codex' && level !== 'off') assert.equal(controls.sdk.modelReasoningEffort, level);
            if (executor === 'claude' && !['adaptive', 'off'].includes(level)) assert.equal(controls.sdk.effort, level);
            const transcript = createTranscript({}, { messages: [{ role: 'user', content: 'Hello' }] });
            let sent;
            const anthropic = executor === 'claude';
            const gateway = createSdkGateway({ protocol: anthropic ? 'anthropic' : 'responses', connection: c, transcript, inputBudget: 8000, maxOutputTokens: 4096,
                fetch: async (_url, init) => { sent = JSON.parse(init.body); return Response.json(anthropic ? { content: [], stop_reason: 'end_turn' } : { output: [], status: 'completed' }); } });
            t.after(() => gateway.close());
            const body = { model: 'test', [anthropic ? 'messages' : 'input']: [{ role: 'user', content: transcript.prompt }],
                [anthropic ? 'max_tokens' : 'max_output_tokens']: 999999,
                ...(anthropic ? { thinking: { type: 'enabled', budget_tokens: 999999 }, output_config: { effort: 'low' } } : { reasoning: { effort: 'low' } }) };
            const response = await gateway.handle(new Request(`http://localhost/v1/${anthropic ? 'messages' : 'responses'}`, { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify(body) }));
            assert.equal(response.status, 200);
            assert.equal(sent[anthropic ? 'max_tokens' : 'max_output_tokens'], 4096);
            for (const [key, value] of Object.entries(controls.wire)) assert.deepEqual(sent[key], value);
            if (anthropic && !controls.wire.output_config) assert.equal(sent.output_config, undefined);
        }
    });
}

test('SDK default thinking budget stays inside reduced per-request output limit', async t => {
    const transcript = createTranscript({}, { messages: [{ role: 'user', content: 'Hello' }] });
    let dispatched = false;
    const gateway = createSdkGateway({ protocol: 'anthropic', connection, transcript, inputBudget: 8000, maxOutputTokens: 4096, fetch: async () => { dispatched = true; } });
    t.after(() => gateway.close());
    const response = await gateway.handle(new Request('http://localhost/v1/messages', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'test', max_tokens: 2000, thinking: { type: 'enabled', budget_tokens: 2048 }, messages: [{ role: 'user', content: transcript.prompt }] }) }));
    assert.equal(response.status, 422); assert.equal(dispatched, false);
});

test('reasoning unknown fields and invalid combinations are rejected, not discarded', () => {
    for (const reasoning of ['ultra', { ignored: true }, { thinking: { type: 'enabled', budgetTokens: 5 } }, { thinking: { type: 'disabled' }, effort: 'high' }]) {
        assert.throws(() => preflight('claude', { connection: { ...connection, reasoning } }));
    }
    assert.throws(() => preflight('codex', { connection: { ...connection, reasoning: { effort: 'high' } } }), { code: 'invalid-connection' });
    assert.match(historyInstructions('native-transcript'), /native ordered/);
    assert.match(historyInstructions('structured-transcript'), /structured-transcript interpretation/);
});

for (const executor of ['claude', 'codex']) {
    test(`${executor}: flat canonical connection rejects removed configuration aliases`, () => {
        for (const invalid of [{ data: connection }, { ...connection, effort: 'high' },
            { ...connection, reasoning: { effort: 'high' } }, { ...connection, reasoning: null },
            { ...connection, mediaTokenCost: { image: 100 } }]) {
            assert.throws(() => preflight(executor, { connection: invalid }), { code: 'invalid-connection' });
        }
        assert.doesNotThrow(() => preflight(executor, { connection: { ...connection, reasoning: 'high', capabilities: { mediaTokenCost: { image: 100 } } } }));
        assert.equal(reasoningControls(executor, undefined).mode, 'sdk-default');
    });
}

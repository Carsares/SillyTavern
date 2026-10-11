import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage } from '../../../../src/conversation/traces/usage.js';

test('generation and auxiliary usage totals do not double-count cached/reasoning tokens', () => {
    const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, reasoningTokens: 10, totalTokens: 120, costUsd: 0.1, complete: true, requests: [{}] };
    const traces = [
        { id: 'a', turnId: 't', requestPlan: {}, usage },
        { id: 'r', turnId: 't', parentTraceId: 'a', kind: 'outbound-request' },
        { id: 'b', kind: 'memory', requestPlan: {}, usage },
        { id: 's', parentTraceId: 'b', kind: 'outbound-request', category: 'memory' },
    ];
    const result = summarizeUsage(traces);
    assert.equal(result.totals.calls, 2);
    assert.equal(result.totals.totalTokens, 240);
    assert.equal(result.totals.costUsd, 0.2);
    assert.equal(result.categories.memory.inputTokens, 100);
    assert.equal(result.turns[0].totalTokens, 120);
});

test('unreported or failed attempted requests make totals unknown instead of zero', () => {
    const result = summarizeUsage([{ id: 't', requestPlan: {}, status: 'failed' }, { id: 'r', kind: 'outbound-request', parentTraceId: 't' }]);
    assert.equal(result.totals.calls, 1); assert.equal(result.totals.inputTokens, null);
    assert.equal(result.totals.costUsd, null); assert.equal(result.totals.complete, false);
});

test('resuming a provider job attributes its recovered usage to the original single request', () => {
    const usage = { complete: true, inputTokens: 4, outputTokens: 2, totalTokens: 6, requests: [{}] };
    const result = summarizeUsage([
        { id: 'original', turnId: 'first-turn', requestPlan: {}, status: 'failed' },
        { id: 'post', parentTraceId: 'original', kind: 'outbound-request' },
        { id: 'retry', turnId: 'retry-turn', requestPlan: {}, providerJob: { resumed: true, originalTraceId: 'original' }, usage },
        { id: 'poll', parentTraceId: 'retry', kind: 'outbound-poll' },
    ]);
    assert.equal(result.totals.calls, 1);
    assert.equal(result.totals.totalTokens, 6);
    assert.equal(result.totals.complete, true);
    assert.deepEqual(result.turns.map(turn => turn.turnId), ['first-turn']);
});

test('partial cumulative usage is counted once and a later unreported request marks incomplete', () => {
    const usage = { complete: true, inputTokens: 4, outputTokens: 2, totalTokens: 6, requests: [{}] };
    const result = summarizeUsage([{ id: 'a', requestPlan: {}, events: [{ type: 'usage.updated', usage }, { type: 'usage.updated', usage }] },
        { id: 'r1', kind: 'outbound-request', parentTraceId: 'a' }, { id: 'r2', kind: 'outbound-request', parentTraceId: 'a' }]);
    assert.equal(result.totals.calls, 2); assert.equal(result.totals.complete, false);
    assert.equal(result.totals.inputTokens, null);
});

test('reported and estimated money retain their distinction in totals', () => {
    const rows = [{ id: 'a', requestPlan: {}, usage: { costUsd: 0.1, costSource: 'provider', costEstimated: false } },
        { id: 'b', requestPlan: {}, usage: { costUsd: 0.2, costSource: 'sdk-estimated', costEstimated: true } }];
    const mixed = summarizeUsage(rows).totals;
    assert.ok(Math.abs(mixed.costUsd - 0.3) < 1e-10);
    assert.equal(mixed.costEstimated, true); assert.equal(mixed.costSource, 'mixed');
    rows.push({ id: 'unknown', requestPlan: {}, usage: { costUsd: null } });
    const unknown = summarizeUsage(rows).totals;
    assert.equal(unknown.costUsd, null); assert.equal(unknown.costEstimated, null); assert.equal(unknown.costSource, null);
});

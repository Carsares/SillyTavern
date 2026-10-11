import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluation } from './runner.mjs';
import { createDataset } from './dataset.mjs';

// Pure adapter doubles: no transport, credentials, filesystem writes or network.
const dataset = createDataset();
const quote = { hardUpperBound: true, maxCostUsd: 0.5, maxRequests: 4, maxInputTokens: 400, maxOutputTokens: 40 };
const budget = { maxCostUsd: 100, maxRequests: 1000, maxInputTokens: 100000, maxOutputTokens: 10000, deadlineMs: 100000 };
const usage = { complete: true, costUsd: null, costComplete: false, costUpperBoundUsd: 0.125, costBasis: 'configured-price-upper-bound', providerRequests: 1, inputTokens: 100, outputTokens: 10 };
function adapter(run) {
    return { capabilities: { verified: true, executor: 'pi', model: 'offline', modelVersion: 'test', contextWindow: 1000000, maxOutputTokens: 1000, budgets: ['32k'], cacheModes: ['uncontrolled'] }, quote: async () => ({ ...quote }), run };
}
function response(request, value = usage) {
    return { usage: { ...value }, output: { answers: [] }, cache: { mode: 'uncontrolled', sessionKey: request.condition.sessionKey } };
}
const execute = (run, options = {}) => runEvaluation({ dataset, evidence: 'mock', config: { allowPaid: true, batchSize: 200, cacheModes: ['uncontrolled'], budget: { ...budget, ...options.budget } }, adapters: { pi: adapter(run) }, signal: options.signal });
function held(result) {
    for (const key of ['CostUsd', 'Requests', 'InputTokens', 'OutputTokens']) {
        assert.equal(result.ledger['reserved' + key], quote['max' + key]);
        assert.equal(result.ledger['currentHeld' + key], quote['max' + key]);
        assert.equal(result.ledger['settled' + key], 0);
    }
    assert.equal(result.ledger.actualCostUnknown, true);
    assert.equal(result.ledger.actualCostUsd, null);
    assert.equal(result.measurements.length, 1);
    assert.equal(result.measurements[0].budgetSettlement.status, 'held');
}
test('explicit zero-dispatch blocks release every dimension for subsequent conditions', async () => {
    let calls = 0;
    const result = await execute(() => {
        calls++;
        throw Object.assign(new Error('never log private details'), { blocked: true, dispatched: false, providerRequests: 0, code: 'preflight-blocked', reservations: { requests: 0, input: 0, output: 0, costUpper: 0, secret: 'do not log' } });
    }, { budget: { maxCostUsd: quote.maxCostUsd, maxRequests: quote.maxRequests, maxInputTokens: quote.maxInputTokens, maxOutputTokens: quote.maxOutputTokens } });
    assert.equal(calls, 3); // all three 32k conditions reached; no phantom budget exhaustion
    for (const key of ['CostUsd', 'Requests', 'InputTokens', 'OutputTokens']) {
        assert.equal(result.ledger['reserved' + key], 0);
        assert.equal(result.ledger['currentHeld' + key], 0);
        assert.equal(result.ledger['quoted' + key], 3 * quote['max' + key]);
    }
    assert.equal(result.ledger.actualCostUsd, 0); assert.equal(result.ledger.actualCostUnknown, false);
    assert.deepEqual(result.measurements[0].dispatch, { dispatched: false, providerRequests: 0, reservations: { requests: 0, input: 0, output: 0, costUpper: 0 } });
    assert.ok(result.measurements.every(row => row.budgetSettlement.status === 'released-not-dispatched'));
    assert.doesNotMatch(JSON.stringify(result), /private details|do not log/);
});
test('complete upper-bound usage settles money, tokens and requests independently', async () => {
    for (const limit of [{ maxCostUsd: 0.75 }, { maxRequests: 6 }, { maxInputTokens: 600 }, { maxOutputTokens: 60 }]) {
        let calls = 0;
        const result = await execute(request => { calls++; return response(request); }, { budget: limit });
        assert.equal(calls, 3, JSON.stringify(limit));
        assert.equal(result.conditions[0].reason, 'budget-exhausted');
        assert.equal(result.ledger.reservedCostUsd, 0.375);
        assert.equal(result.ledger.reservedRequests, 3);
        assert.equal(result.ledger.reservedInputTokens, 300);
        assert.equal(result.ledger.reservedOutputTokens, 30);
        assert.equal(result.ledger.quotedCostUsd, 1.5);
        assert.equal(result.ledger.currentHeldCostUsd, 0);
        assert.equal(result.ledger.settledCostUsd, 0.375);
        assert.equal(result.ledger.actualCostUsd, null);
        assert.equal(result.ledger.actualCostComplete, false);
        assert.equal(result.ledger.actualCostUnknown, true);
    }
});
test('known cost settles without inventing an unknown cost; larger valid upper bound stays conservative', async () => {
    for (const upper of [undefined, 0.25]) {
        const result = await execute(request => response(request, { ...usage, costUsd: 0.125, costComplete: true, costUpperBoundUsd: upper }), { budget: { maxRequests: 4 } });
        assert.equal(result.measurements.length, 1);
        assert.equal(result.ledger.reservedCostUsd, upper ?? 0.125);
        assert.equal(result.ledger.actualCostUsd, 0.125);
        assert.equal(result.ledger.actualCostUnknown, false);
    }
});
test('incomplete usage, missing cost and untrusted cost bounds halt without releasing', async () => {
    for (const patch of [{ complete: false }, { inputTokens: null }, { outputTokens: -1 }, { providerRequests: 0 }, { costUpperBoundUsd: null }, { costBasis: 'estimate' }]) {
        const result = await execute(request => response(request, { ...usage, ...patch }));
        held(result); assert.equal(result.measurements[0].reason, 'usage-or-cost-unknown');
    }
});
test('all quote dimensions still reject overruns before settlement', async () => {
    for (const patch of [{ costUpperBoundUsd: 0.51 }, { costUsd: 0.51 }, { inputTokens: 401 }, { outputTokens: 41 }, { providerRequests: 5 }]) {
        const result = await execute(request => response(request, { ...usage, ...patch }));
        assert.equal(result.measurements.length, 1);
        assert.equal(result.measurements[0].reason, 'adapter-exceeded-reservation');
        for (const key of ['CostUsd', 'Requests', 'InputTokens', 'OutputTokens']) assert.equal(result.ledger['currentHeld' + key], quote['max' + key]);
        assert.equal(result.ledger.settledCostUsd, 0);
    }
});
test('dispatched or ambiguous failures keep the full quote regardless of small diagnostic reservations', async () => {
    for (const flags of [{ blocked: true, dispatched: true }, { blocked: true }, { dispatched: false }, { blocked: true, dispatched: false, providerRequests: 1 }]) {
        const result = await execute(() => { throw Object.assign(new Error('private'), { reservations: { requests: 1, input: 1, output: 0, costUpper: 0.001 }, ...flags }); });
        held(result); assert.equal(result.measurements[0].reason, 'provider-outcome-unknown');
        assert.equal(result.measurements[0].dispatch.reservations.costUpper, 0.001);
    }
});
test('abort retains full reservation even if adapter later claims no dispatch or returns complete usage', async () => {
    for (const mode of ['throw', 'complete']) {
        const controller = new AbortController();
        const result = await execute(request => {
            controller.abort();
            if (mode === 'throw') throw Object.assign(new Error('abort'), { blocked: true, dispatched: false });
            return response(request);
        }, { signal: controller.signal });
        held(result); assert.equal(result.measurements[0].reason, 'aborted-outcome-unknown');
    }
});
test('later unknown requests retain their entire quote in addition to earlier settled consumption', async () => {
    let calls = 0;
    const result = await execute(request => { if (++calls === 1) return response(request); throw new Error('uncertain'); });
    assert.equal(calls, 2);
    assert.equal(result.ledger.settledCostUsd, 0.125);
    assert.equal(result.ledger.currentHeldCostUsd, 0.5);
    assert.equal(result.ledger.reservedCostUsd, 0.625);
    assert.equal(result.ledger.reservedRequests, 5);
    assert.equal(result.ledger.reservedInputTokens, 500);
    assert.equal(result.ledger.reservedOutputTokens, 50);
    assert.equal(result.ledger.actualCostUnknown, true);
});
test('cache verification failure does not discard complete conservative billing evidence', async () => {
    const result = await execute(request => ({ ...response(request), cache: { mode: 'wrong' } }), { budget: { maxRequests: 4 } });
    assert.equal(result.measurements.length, 1);
    assert.equal(result.measurements[0].reason, 'cache-condition-unverified');
    assert.equal(result.ledger.currentHeldCostUsd, 0);
    assert.equal(result.ledger.reservedCostUsd, 0.125);
    assert.equal(result.ledger.actualCostUnknown, true);
});
test('pre-dispatch release preserves already settled consumption and does not erase known actual cost', async () => {
    let calls = 0;
    const result = await execute(request => {
        if (++calls === 1) return response(request, { ...usage, costUsd: 0.125, costComplete: true });
        throw Object.assign(new Error('preflight'), { code: 'preflight-blocked', blocked: true, dispatched: false });
    }, { budget: { maxCostUsd: 0.625 } });
    assert.equal(calls, 4);
    assert.equal(result.ledger.reservedCostUsd, 0.125);
    assert.equal(result.ledger.reservedRequests, 1);
    assert.equal(result.ledger.reservedInputTokens, 100);
    assert.equal(result.ledger.reservedOutputTokens, 10);
    assert.equal(result.ledger.currentHeldCostUsd, 0);
    assert.equal(result.ledger.actualCostUsd, 0.125);
    assert.equal(result.ledger.actualCostUnknown, false);
});
test('settlement never admits unbounded or oversized quotations', async () => {
    for (const patch of [{ hardUpperBound: false }, { maxCostUsd: NaN }, { maxRequests: 0 }, { maxInputTokens: 1.5 }, { maxCostUsd: 101 }]) {
        const a = adapter(() => assert.fail('invalid quote cannot dispatch'));
        a.quote = async () => ({ ...quote, ...patch });
        const result = await runEvaluation({ dataset, evidence: 'mock', config: { allowPaid: true, batchSize: 200, cacheModes: ['uncontrolled'], budget }, adapters: { pi: a } });
        assert.equal(result.measurements.length, 0);
        assert.equal(result.ledger.reservedCostUsd, 0);
        assert.equal(result.conditions[0].reason, patch.maxCostUsd === 101 ? 'budget-exhausted' : 'bounded-quotation-required');
    }
});

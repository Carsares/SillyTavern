import { createDataset, publicInput, validateDataset } from './dataset.mjs';
import { scoreAnswers, summarizeMeasurements } from './scorer.mjs';

export const EXECUTORS = ['pi', 'claude', 'codex'];
export const BUDGETS = [{ name: '32k', tokens: 32768 }, { name: '64k', tokens: 65536 }, { name: '128k', tokens: 131072 }, { name: 'full', tokens: null }];
export function evaluationMatrix(cacheModes = ['cold', 'warm']) {
    return EXECUTORS.flatMap(executor => BUDGETS.flatMap(budget => [1, 2, 3].flatMap(repeat => cacheModes.map(cache => ({
        id: `${executor}/${budget.name}/${repeat}/${cache}`, executor, budget: budget.name, workingBudget: budget.tokens, repeat, cache,
        sessionKey: `${executor}/${budget.name}/${repeat}`,
    })))));
}
const positiveInt = value => Number.isSafeInteger(value) && value > 0;
export function validateRunConfig(config) {
    if (!config?.allowPaid) return 'paid-authorization-required';
    const b = config.budget;
    if (!b || !Number.isFinite(b.maxCostUsd) || b.maxCostUsd <= 0 || !['maxRequests', 'maxInputTokens', 'maxOutputTokens', 'deadlineMs'].every(key => positiveInt(b[key]))) return 'explicit-budget-required';
    if (!positiveInt(config.batchSize ?? 50) || (config.batchSize ?? 50) > 200) return 'invalid-batch-size';
    if (config.cacheModes !== undefined && JSON.stringify(config.cacheModes) !== '["uncontrolled"]' && JSON.stringify(config.cacheModes) !== '["cold","warm"]') return 'invalid-cache-modes';
    return null;
}
function quoteValid(quote) {
    return quote && Number.isFinite(quote.maxCostUsd) && quote.maxCostUsd >= 0 && positiveInt(quote.maxInputTokens) && positiveInt(quote.maxOutputTokens) && positiveInt(quote.maxRequests)
        && quote.hardUpperBound === true;
}

/** No built-in provider or SDK import. The adapter owns actual context/SDK calls.
 * All paid work, including summaries/embeddings, must fit one reserved quotation. */
export async function runEvaluation({ config, adapters = {}, dataset = createDataset(), signal, now = Date.now, onRecord = () => {}, evidence = 'real-provider' } = {}) {
    const check = validateDataset(dataset);
    if (check.status !== 'passed') throw new Error('Evaluation dataset is invalid');
    const plan = evaluationMatrix(JSON.stringify(config?.cacheModes) === '["uncontrolled"]' ? ['uncontrolled'] : undefined);
    const scope = config?.cacheModes?.[0] === 'uncontrolled'
        ? { evaluationScope: 'uncontrolled-diagnostic', fullG5: false } : { evaluationScope: 'cold-warm-matrix' };
    const configError = validateRunConfig(config);
    if (configError) return { ...scope, status: 'blocked', reason: configError, evidence: 'not-run', dataset: dataset.fingerprint,
        conditions: plan.map(condition => ({ ...condition, status: 'blocked', reason: configError })), measurements: [], quality: null };
    const budget = config.budget, startedAt = now(), measurements = [], conditions = [];
    // reserved = settled conservative consumption + unresolved full quotations.
    // quoted is historical admission volume, not the remaining budget occupation.
    const dimensions = ['CostUsd', 'Requests', 'InputTokens', 'OutputTokens'];
    const ledger = { actualCostUsd: 0, actualCostComplete: true };
    for (const key of dimensions) for (const prefix of ['reserved', 'quoted', 'settled', 'currentHeld']) ledger[prefix + key] = 0;
    const hold = quote => {
        for (const key of dimensions) {
            ledger['quoted' + key] += quote['max' + key];
            ledger['currentHeld' + key] = quote['max' + key];
            ledger['reserved' + key] = ledger['settled' + key] + ledger['currentHeld' + key];
        }
    };
    const settle = amounts => {
        for (const key of dimensions) {
            ledger['settled' + key] += amounts[key];
            ledger['currentHeld' + key] = 0;
            ledger['reserved' + key] = ledger['settled' + key];
        }
    };
    const batchSize = config.batchSize ?? 50;
    const coldCompleted = new Set();
    let halted;
    for (const condition of plan) {
        let reason = halted;
        const adapter = adapters[condition.executor];
        if (!reason && (!adapter || typeof adapter.run !== 'function' || typeof adapter.quote !== 'function')) reason = 'adapter-not-configured';
        const cap = adapter?.capabilities;
        if (!reason && (!(cap?.verified || cap?.runtimeWired) || cap.executor !== condition.executor || typeof cap.model !== 'string' || !cap.model || typeof cap.modelVersion !== 'string' || !cap.modelVersion
            || !positiveInt(cap.contextWindow) || !positiveInt(cap.maxOutputTokens) || !cap.budgets?.includes(condition.budget) )) reason = cap?.blockedReason ?? 'capability-unverified';
        if (!reason && (condition.cache === 'uncontrolled' ? !cap.cacheModes?.includes('uncontrolled') : cap.cacheControl !== true)) reason = cap.cacheBlockedReason ?? 'cache-condition-unverified';
        if (!reason && condition.workingBudget !== null && condition.workingBudget > cap.contextWindow - cap.maxOutputTokens) reason = 'context-window-too-small';
        if (!reason && condition.cache === 'warm' && !coldCompleted.has(condition.sessionKey)) reason = 'cold-baseline-incomplete';
        const rows = [], combined = [];
        if (!reason) for (let start = 0; start < dataset.questions.length; start += batchSize) {
            if (signal?.aborted || now() - startedAt >= budget.deadlineMs) { reason = halted = signal?.aborted ? 'aborted' : 'deadline-exceeded'; break; }
            const questions = dataset.questions.slice(start, start + batchSize);
            const input = publicInput(dataset, questions);
            // 'full' means no history compaction or dropping; unsupported full context must block.
            const request = { ...input, condition: { ...condition }, preserveFullHistory: condition.budget === 'full' };
            let quote;
            try { quote = await adapter.quote(request); } catch (error) { reason = error.blocked ? error.code : 'quotation-unavailable'; break; }
            if (!quoteValid(quote)) { reason = 'bounded-quotation-required'; break; }
            if (ledger.reservedCostUsd + quote.maxCostUsd > budget.maxCostUsd || ledger.reservedRequests + quote.maxRequests > budget.maxRequests
                || ledger.reservedInputTokens + quote.maxInputTokens > budget.maxInputTokens || ledger.reservedOutputTokens + quote.maxOutputTokens > budget.maxOutputTokens) {
                reason = halted = 'budget-exhausted'; break;
            }
            if (now() - startedAt >= budget.deadlineMs || signal?.aborted) { reason = halted = 'deadline-exceeded'; break; }
            // Never refund uncertain reservations; retries require a separate explicitly budgeted run.
            hold(quote);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), Math.max(1, budget.deadlineMs - (now() - startedAt)));
            const forward = () => controller.abort(); signal?.addEventListener('abort', forward, { once: true });
            const before = now();
            const row = { conditionId: condition.id, batch: start / batchSize, questionIds: questions.map(q => q.id), status: 'unknown', evidence,
                model: cap.model, modelVersion: cap.modelVersion, modelResolution: cap.modelResolution ?? null, quote: { maxCostUsd: quote.maxCostUsd, maxRequests: quote.maxRequests, maxInputTokens: quote.maxInputTokens, maxOutputTokens: quote.maxOutputTokens, hardUpperBound: true }, firstTokenMs: null };
            let abortListener, responseReceived = false;
            try {
                await onRecord({ phase: 'intent', conditionId: condition.id, batch: row.batch, quote: row.quote, modelResolution: row.modelResolution, evidence });
                controller.signal.throwIfAborted();
                const aborted = new Promise((_, reject) => { abortListener = () => reject(new Error('aborted')); controller.signal.addEventListener('abort', abortListener, { once: true }); });
                const response = await Promise.race([Promise.resolve().then(() => adapter.run({ ...request, signal: controller.signal, ceiling: { ...quote },
                    onFirstToken: () => { row.firstTokenMs ??= now() - before; } })), aborted]);
                responseReceived = true;
                controller.signal.throwIfAborted();
                row.elapsedMs = now() - before;
                const u = response?.usage;
                const costKnown = Number.isFinite(u?.costUsd) && u.costUsd >= 0;
                const boundedCost = u?.costBasis === 'configured-price-upper-bound' && Number.isFinite(u.costUpperBoundUsd) && u.costUpperBoundUsd >= 0;
                const validUsage = u?.complete === true && (costKnown || boundedCost) && ['inputTokens', 'outputTokens', 'providerRequests'].every(key => Number.isSafeInteger(u[key]) && u[key] >= 0) && u.providerRequests > 0;
                if (!validUsage) { ledger.actualCostComplete = false; reason = halted = 'usage-or-cost-unknown'; }
                else {
                    row.usage = { costUsd: costKnown ? u.costUsd : null, costUpperBoundUsd: boundedCost ? u.costUpperBoundUsd : null, inputTokens: u.inputTokens, outputTokens: u.outputTokens, providerRequests: u.providerRequests, complete: true };
                    if (costKnown) ledger.actualCostUsd += u.costUsd; else ledger.actualCostComplete = false;
                    if (u.costUsd > quote.maxCostUsd || boundedCost && u.costUpperBoundUsd > quote.maxCostUsd || u.inputTokens > quote.maxInputTokens || u.outputTokens > quote.maxOutputTokens || u.providerRequests > quote.maxRequests) reason = halted = 'adapter-exceeded-reservation';
                    if (!reason && (condition.cache !== 'uncontrolled' && response.cache?.verified !== true || response.cache?.mode !== condition.cache || response.cache?.sessionKey !== condition.sessionKey)) reason = 'cache-condition-unverified';
                    if (!reason) {
                        row.score = scoreAnswers(questions, response.output);
                        row.status = 'completed';
                        let parsed = response.output;
                        try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); } catch { parsed = null; }
                        combined.push(...(Array.isArray(parsed?.answers) ? parsed.answers : []));
                    }
                    if (reason !== 'adapter-exceeded-reservation') {
                        // Both declared costs were checked against the quote above. Prefer the
                        // larger verified upper bound when present; never report it as actual cost.
                        const cost = Math.max(costKnown ? u.costUsd : 0, boundedCost ? u.costUpperBoundUsd : 0);
                        settle({ CostUsd: cost, Requests: u.providerRequests, InputTokens: u.inputTokens, OutputTokens: u.outputTokens });
                        row.budgetSettlement = { status: 'settled', costUsd: cost, costBasis: boundedCost ? 'configured-price-upper-bound' : 'known-cost' };
                    }
                }
                if (reason) { row.reason = reason; row.status = validUsage ? 'failed' : 'unknown'; }
            } catch (error) {
                // Diagnostics never authorize a refund on an uncertain dispatched outcome.
                row.dispatch = {};
                if (typeof error.dispatched === 'boolean') row.dispatch.dispatched = error.dispatched;
                if (Number.isSafeInteger(error.providerRequests) && error.providerRequests >= 0) row.dispatch.providerRequests = error.providerRequests;
                const reservations = {};
                for (const key of ['requests', 'input', 'output', 'costUpper']) {
                    const value = error.reservations?.[key];
                    if ((key === 'costUpper' ? Number.isFinite(value) : Number.isSafeInteger(value)) && value >= 0) reservations[key] = value;
                }
                if (Object.keys(reservations).length) row.dispatch.reservations = reservations;
                if (!responseReceived && !controller.signal.aborted && error.blocked && error.dispatched === false && !(error.providerRequests > 0) && !(error.reservations?.requests > 0)) {
                    settle({ CostUsd: 0, Requests: 0, InputTokens: 0, OutputTokens: 0 });
                    row.budgetSettlement = { status: 'released-not-dispatched', costUsd: 0 };
                    reason = error.code || 'adapter-blocked-before-dispatch'; row.status = 'blocked'; row.elapsedMs = now() - before; row.reason = reason;
                } else {
                    ledger.actualCostComplete = false;
                    reason = halted = controller.signal.aborted ? 'aborted-outcome-unknown' : 'provider-outcome-unknown';
                    row.elapsedMs = now() - before; row.reason = reason;
                }
            } finally {
                clearTimeout(timeout); signal?.removeEventListener('abort', forward);
                if (abortListener) controller.signal.removeEventListener('abort', abortListener);
            }
            row.budgetSettlement ??= { status: 'held', costUsd: quote.maxCostUsd };
            rows.push(row); measurements.push(row);
            await onRecord(structuredClone(row));
            if (reason) break;
        }
        const complete = !reason && rows.length === Math.ceil(dataset.questions.length / batchSize) && rows.every(row => row.status === 'completed');
        const result = { ...condition, status: complete ? 'completed' : 'blocked', ...(reason ? { reason } : {}),
            score: complete ? scoreAnswers(dataset.questions, { answers: combined }) : null, measurements: summarizeMeasurements(rows) };
        conditions.push(result);
        if (complete && condition.cache === 'cold') coldCompleted.add(condition.sessionKey);
    }
    const complete = conditions.every(c => c.status === 'completed');
    return { ...scope, status: complete ? 'completed' : 'blocked', evidence, dataset: dataset.fingerprint, datasetId: dataset.id,
        quality: complete ? (conditions.every(c => c.score.gate === 'passed') ? 'passed' : 'failed') : null,
        conditions, measurements, ledger: { ...ledger, actualCostUnknown: !ledger.actualCostComplete, actualCostUsd: ledger.actualCostComplete ? ledger.actualCostUsd : null },
        summary: summarizeMeasurements(measurements) };
}

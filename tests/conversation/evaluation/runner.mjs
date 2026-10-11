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
    const configError = validateRunConfig(config);
    if (configError) return { status: 'blocked', reason: configError, evidence: 'not-run', dataset: dataset.fingerprint,
        conditions: plan.map(condition => ({ ...condition, status: 'blocked', reason: configError })), measurements: [], quality: null };
    const budget = config.budget, startedAt = now(), measurements = [], conditions = [];
    const ledger = { reservedCostUsd: 0, reservedRequests: 0, reservedInputTokens: 0, reservedOutputTokens: 0, actualCostUsd: 0, actualCostComplete: true };
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
            ledger.reservedCostUsd += quote.maxCostUsd; ledger.reservedRequests += quote.maxRequests;
            ledger.reservedInputTokens += quote.maxInputTokens; ledger.reservedOutputTokens += quote.maxOutputTokens;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), Math.max(1, budget.deadlineMs - (now() - startedAt)));
            const forward = () => controller.abort(); signal?.addEventListener('abort', forward, { once: true });
            const before = now();
            const row = { conditionId: condition.id, batch: start / batchSize, questionIds: questions.map(q => q.id), status: 'unknown', evidence,
                model: cap.model, modelVersion: cap.modelVersion, quote: { maxCostUsd: quote.maxCostUsd, maxRequests: quote.maxRequests, maxInputTokens: quote.maxInputTokens, maxOutputTokens: quote.maxOutputTokens, hardUpperBound: true }, firstTokenMs: null };
            let abortListener;
            try {
                await onRecord({ phase: 'intent', conditionId: condition.id, batch: row.batch, quote: row.quote, evidence });
                controller.signal.throwIfAborted();
                const aborted = new Promise((_, reject) => { abortListener = () => reject(new Error('aborted')); controller.signal.addEventListener('abort', abortListener, { once: true }); });
                const response = await Promise.race([Promise.resolve().then(() => adapter.run({ ...request, signal: controller.signal, ceiling: { ...quote },
                    onFirstToken: () => { row.firstTokenMs ??= now() - before; } })), aborted]);
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
                    else if (condition.cache !== 'uncontrolled' && response.cache?.verified !== true || response.cache?.mode !== condition.cache || response.cache.sessionKey !== condition.sessionKey) reason = 'cache-condition-unverified';
                    else {
                        row.score = scoreAnswers(questions, response.output);
                        row.status = 'completed';
                        let parsed = response.output;
                        try { if (typeof parsed === 'string') parsed = JSON.parse(parsed); } catch { parsed = null; }
                        combined.push(...(Array.isArray(parsed?.answers) ? parsed.answers : []));
                    }
                }
                if (reason) { row.reason = reason; row.status = validUsage ? 'failed' : 'unknown'; }
            } catch (error) {
                if (error.blocked && error.dispatched === false) {
                    reason = error.code; row.status = 'blocked'; row.elapsedMs = now() - before; row.reason = reason;
                } else {
                ledger.actualCostComplete = false;
                reason = halted = controller.signal.aborted ? 'aborted-outcome-unknown' : 'provider-outcome-unknown';
                row.elapsedMs = now() - before; row.reason = reason;
                }
            } finally {
                clearTimeout(timeout); signal?.removeEventListener('abort', forward);
                if (abortListener) controller.signal.removeEventListener('abort', abortListener);
            }
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
    return { status: complete ? 'completed' : 'blocked', evidence, dataset: dataset.fingerprint, datasetId: dataset.id,
        quality: complete ? (conditions.every(c => c.score.gate === 'passed') ? 'passed' : 'failed') : null,
        conditions, measurements, ledger: { ...ledger, actualCostUsd: ledger.actualCostComplete ? ledger.actualCostUsd : null },
        summary: summarizeMeasurements(measurements) };
}

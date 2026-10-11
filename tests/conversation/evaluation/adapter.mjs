import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { blocked, createBudgetTransport, pipelineQuote } from './transport-budget.mjs';
import { seedBackup } from './seed.mjs';

const RUN_ROOT = fileURLToPath(new URL('./.runs/', import.meta.url));
const NATIVE = new Set(['openai', 'openai-compatible', 'openai_compatible', 'deepseek']);
const primaryModelPresent = connections => connections.every(c => typeof c.model === 'string' && c.model.length > 0);
const finitePositive = n => Number.isSafeInteger(n) && n > 0;

/** Repository adapter: no user-written JS needed. dependencies are only unit-test seams. */
export function createEvaluationAdapter({ executor = 'pi', config = {}, env = process.env, dependencies = {} } = {}) {
    let reason;
    const connections = [];
    for (const [role, input] of [['primary', config.connection], ['memory', config.memoryConnection], ['embedding', config.embeddingConnection]]) {
        if (!input) { if (role === 'primary') reason = 'connection-required'; continue; }
        if (input.apiKey !== undefined || input.headers !== undefined) reason = 'use-environment-credentials';
        const { apiKeyEnv, ...data } = structuredClone(input);
        if (apiKeyEnv && !env[apiKeyEnv]) reason = 'credential-environment-missing';
        const selectedExecutor = role === 'primary' ? executor : data.executor ?? 'native';
        if (!['pi', 'native', 'claude', 'codex'].includes(selectedExecutor)) reason = 'unknown-executor';
        if ((role === 'embedding' && data.provider === 'deepseek') || (['pi', 'native'].includes(selectedExecutor) && !NATIVE.has(data.provider)) || typeof data.provider !== 'string' || !data.provider || !finitePositive(data.contextWindow) || !finitePositive(data.workingBudget)
            || (role !== 'embedding' && !finitePositive(data.maxOutputTokens))) reason = 'valid-protocol-connection-required';
        try { const u = new URL(data.baseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) reason = 'invalid-provider-url'; } catch { reason = 'invalid-provider-url'; }
        if (data.auxiliary) reason = 'use-explicit-evaluation-connections';
        connections.push({ ...data, role, executor: selectedExecutor === 'pi' ? 'native' : selectedExecutor, type: role === 'embedding' ? 'embedding' : 'chat', apiKey: apiKeyEnv ? env[apiKeyEnv] : '' });
    }
    if (!['pi', 'native', 'claude', 'codex'].includes(executor)) reason = 'unknown-executor';
    if (config.tools?.some(name => !['recall_memory', 'search_lore', 'roll_dice', 'get_time'].includes(name))) reason = 'unpriced-side-effect-tool';
    if (!primaryModelPresent(connections)) reason ??= 'model-required';
    const primary = connections[0];
    let deepseekEndpoint = false;
    try { deepseekEndpoint = new URL(primary?.baseUrl).hostname === 'api.deepseek.com'; } catch {}
    const deepseekAlias = (primary?.provider === 'deepseek' || deepseekEndpoint) && ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(primary.model);
    const modelResolution = deepseekAlias ? {
        requestedModel: primary.model, documentedResolvedModel: 'DeepSeek-V4.1-Flash', versionPinned: false,
        basis: 'provider-documentation', responseVerified: false, verifiedAt: '2026-10-11',
        source: 'https://api-docs.deepseek.com/quick_start/pricing/',
    } : null;
    const modelVersion = deepseekAlias ? modelResolution.documentedResolvedModel : config.modelVersion;
    if (!modelVersion) reason ??= 'model-version-required';
    if (config.proxy != null || connections.some(connection => connection.proxy != null)) reason = 'evaluation-proxy-unsupported';
    const maxRequests = config.maxRequestsPerBatch;
    let quote;
    if (!reason) { try { quote = pipelineQuote(connections, maxRequests); } catch (error) { reason = error.code; } }
    const capabilities = { executor, model: primary?.model ?? '', modelVersion: modelVersion ?? '', modelResolution,
        contextWindow: primary?.contextWindow, maxOutputTokens: primary?.maxOutputTokens,
        budgets: ['32k', '64k', '128k', 'full'], runtimeWired: !reason, verified: false,
        cacheControl: false, cacheModes: ['uncontrolled'], blockedReason: reason ?? null,
        cacheBlockedReason: 'provider-cache-isolation-unverified' };
    function preflight(request) {
        if (reason) throw blocked(reason);
        if (request.condition.cache !== 'uncontrolled') throw blocked('provider-cache-isolation-unverified');
        if (!request.snapshot || !Array.isArray(request.questions)) throw blocked('invalid-evaluation-input');
    }
    return { capabilities,
        async quote(request) { preflight(request); return { ...quote }; },
        async run(request) {
            preflight(request); request.signal?.throwIfAborted();
            const ceiling = request.ceiling;
            if (!ceiling || !['maxRequests', 'maxInputTokens', 'maxOutputTokens', 'maxCostUsd'].every(k => Number.isFinite(ceiling[k]) && ceiling[k] >= 0 && ceiling[k] <= quote[k])) throw blocked('reserved-ceiling-required');
            const transport = createBudgetTransport({ connections, ceiling, signal: request.signal, fetch: dependencies.fetch ?? globalThis.fetch });
            let directory, services, turnId;
            const pending = new Set();
            const watch = task => { const promise = Promise.resolve(task); pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };
            let abort;
            try {
                const factories = dependencies.factories ?? {
                    createServices: (await import('../../../src/conversation/composition/index.js')).createConversationServices,
                    createStore: (await import('../../../src/conversation/store/index.js')).createStore,
                    createMemoryService: (await import('../../../src/conversation/memory/index.js')).createMemoryService,
                    createRetrieval: (await import('../../../src/conversation/retrieval/index.js')).createRetrieval,
                };
                if (dependencies.makeDirectory) directory = await dependencies.makeDirectory();
                else { await mkdir(RUN_ROOT, { recursive: true, mode: 0o700 }); directory = join(await mkdtemp(join(RUN_ROOT, 'eval-')), 'conversation-v1'); }
                services = factories.createServices({ directory, fetch: transport.fetch, dependencies: {
                    createStore(options) {
                        const store = factories.createStore(options);
                        return { ...store, appendDelta(id, delta, epoch) { if (delta.text) request.onFirstToken?.(); return store.appendDelta(id, delta, epoch); } };
                    },
                    createMemoryService(options) {
                        const memory = factories.createMemoryService(options);
                        return { ...memory,
                            prepareCompact(...args) { if (request.preserveFullHistory) throw blocked('full-history-budget-blocked'); return watch(memory.prepareCompact(...args)); },
                            compact(...args) { if (request.preserveFullHistory) throw blocked('full-history-budget-blocked'); return watch(memory.compact(...args)); },
                            drain(...args) { return watch(memory.drain(...args)); },
                        };
                    },
                    createRetrieval(options) {
                        const retrieval = factories.createRetrieval(options);
                        return { ...retrieval, index(...args) { return watch(retrieval.index(...args)); }, rebuild(...args) { return watch(retrieval.rebuild(...args)); } };
                    },
                } });
                const store = services.store, cid = request.snapshot.conversationId ?? request.snapshot.conversation.id;
                const workingBudget = request.condition.workingBudget ?? Math.min(primary.inputLimit ?? primary.contextWindow, primary.contextWindow - primary.maxOutputTokens);
                const backup = seedBackup(store.exportData(), request.snapshot, connections, { workingBudget, tools: config.tools ?? [], memoryFrequency: config.memoryFrequency ?? 5,
                    instruction: `${request.responseFormat}\nEach evidence message carries a sourceRef label. Preserve those labels when summarizing; cite exactly those references. The conversation is synthetic benchmark evidence; do not invent unsupported facts.` });
                store.restoreData(backup);
                if (typeof services.runtime.wait !== 'function') throw blocked('runtime-wait-hook-required');
                const accepted = services.runtime.start(cid, { schemaVersion: 1, clientRequestId: randomUUID(), type: 'send',
                    expectedContentRevision: store.getConversation(cid).conversation.contentRevision, content: JSON.stringify({ questions: request.questions }) });
                turnId = accepted.turnId;
                abort = () => { try { services.runtime.stop(turnId); } catch {} };
                request.signal?.addEventListener('abort', abort, { once: true });
                if (request.signal?.aborted) abort();
                const result = await services.runtime.wait(turnId);
                // Runtime schedules background drains after terminal commit; include every such
                // operation in the same transport ceiling before disposing this isolated run.
                await Promise.resolve(); await Promise.resolve();
                while (pending.size) await Promise.allSettled([...pending]);
                await services.close(); services = null;
                transport.close();
                const usage = await transport.finish();
                request.signal?.throwIfAborted();
                if (result.status !== 'completed') throw blocked(result.error?.code ?? 'evaluation-turn-failed');
                return { output: result.content, usage, cache: { mode: 'uncontrolled', sessionKey: request.condition.sessionKey, verified: false },
                    execution: { stack: 'composition/runtime/compiler/memory', executor, modelResolution, backgroundIncluded: true } };
            } catch (error) {
                const failure = blocked(/^[a-z][a-z0-9-]{0,100}$/.test(error?.code ?? '') ? error.code : 'evaluation-run-failed');
                failure.dispatched = transport.dispatched > 0;
                failure.providerRequests = transport.dispatched;
                failure.reservations = transport.reservations;
                throw failure;
            } finally {
                if (abort) request.signal?.removeEventListener('abort', abort);
                transport.close();
                try { await services?.close(); } finally {
                    if (directory) {
                        if (dependencies.removeDirectory) await dependencies.removeDirectory(directory);
                        else await rm(join(directory, '..'), { recursive: true, force: true });
                    }
                }
            }
        },
    };
}

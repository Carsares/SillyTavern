// Explicit opt-in only. Read selected local connection credentials into memory;
// never persist them or copy existing conversations into test state.
import assert from 'node:assert/strict';
import { createProviderStream, createProviderModel, providerCapabilities } from '../../../src/conversation/providers/chat/bridge.js';
import { readFile } from 'node:fs/promises';
import { createPiExecutor } from '../../../src/conversation/executors/pi/index.js';
import { createClaudeExecutor } from '../../../src/conversation/executors/claude/index.js';
import { createCodexExecutor } from '../../../src/conversation/executors/codex/index.js';

const argv = process.argv.slice(2);
function argument(name) { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; }
if (!argv.includes('--run') || !argument('--settings') || !argument('--secrets')) {
    console.log(JSON.stringify({ status: 'not-run', required: '--run --settings <explicit settings file> --secrets <explicit secrets file>', limits: { modelRequests: 3, outputTokensPerRequest: 300, timeoutMsPerExecutor: 45000 } }));
    process.exitCode = 2;
} else {
    let dispatched = 0;
    const results = [];
    try {
        const selected = (argument('--executors') ?? 'pi,claude,codex').split(',');
        if (!selected.length || new Set(selected).size !== selected.length || selected.some(kind => !['pi', 'claude', 'codex'].includes(kind))) {
            throw Object.assign(new Error(), { code: 'invalid-executor-selection' });
        }
        const settings = JSON.parse(await readFile(argument('--settings'), 'utf8')).oai_settings;
        const secrets = JSON.parse(await readFile(argument('--secrets'), 'utf8'));
        if (settings?.chat_completion_source !== 'custom') throw Object.assign(new Error(), { code: 'selected-custom-connection-required' });
        const secret = secrets.api_key_custom;
        const apiKey = typeof secret === 'string' ? secret : secret?.find(item => item.active)?.value;
        const endpoint = new URL(settings.custom_url);
        if (!apiKey || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Object.assign(new Error(), { code: 'invalid-selected-connection' });
        const contextWindow = Math.min(32768, settings.openai_max_context);
        const maxOutputTokens = Math.min(300, settings.openai_max_tokens);
        if (![contextWindow, maxOutputTokens].every(value => Number.isSafeInteger(value) && value > 0)) throw Object.assign(new Error(), { code: 'configured-budgets-required' });
        for (const kind of selected) {
            if (endpoint.origin !== 'https://api.deepseek.com') { results.push({ executor: kind, status: 'blocked', reason: 'selected-endpoint-protocol-unverified' }); continue; }
            const baseUrl = kind === 'claude' ? `${endpoint.origin}/anthropic` : kind === 'codex' ? endpoint.origin : `${endpoint.origin}/v1`;
            const connection = { provider: kind === 'pi' ? 'deepseek' : kind === 'claude' ? 'anthropic' : 'openai-compatible', executor: kind, type: 'chat', model: settings.custom_model,
                baseUrl, apiKey, contextWindow, maxOutputTokens, workingBudget: contextWindow - maxOutputTokens - Math.max(256, Math.ceil(contextWindow * 0.02)), reasoning: 'off' };
            const events = [];
            let executorRequests = 0;
            // Same named-provider bridge selected by composition for provider=deepseek.
            // This validates executor/transport composition, not routes, persistence or UI.
            const guardedFetch = async (input, init) => {
                const request = new Request(input, init);
                const path = kind === 'pi' ? '/v1/chat/completions' : kind === 'claude' ? '/anthropic/v1/messages' : '/responses';
                assert.equal(request.url, `${endpoint.origin}${path}`, 'unexpected-live-endpoint');
                assert.equal(request.method, 'POST');
                const body = await request.clone().json();
                assert.equal(body.model, connection.model);
                assert.equal(body.stream, true);
                const outputCap = kind === 'codex' ? body.max_output_tokens : body.max_tokens;
                assert.ok(Number.isSafeInteger(outputCap) && outputCap > 0 && outputCap <= maxOutputTokens, 'live-output-budget');
                assert.equal(kind === 'codex' ? body.reasoning?.effort : body.thinking?.type, kind === 'codex' ? 'none' : 'disabled');
                assert.equal(body.tools?.length ?? 0, 0);
                // Check actual serialized payload too: PI's beforeRequest sees pre-encoding history.
                assert.ok(Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024 <= connection.workingBudget, 'live-wire-input-budget');
                if (executorRequests >= 1 || dispatched >= 3) throw Object.assign(new Error(), { code: 'live-request-limit' });
                executorRequests++; dispatched++;
                return fetch(request, { redirect: 'error' });
            };
            const factory = kind === 'pi' ? createPiExecutor : kind === 'claude' ? createClaudeExecutor : createCodexExecutor;
            const started = Date.now(), before = dispatched;
            try {
                assert.ok(connection.workingBudget > 0, 'configured-working-budget-required');
                const adapter = factory({ fetch: guardedFetch, ...(kind === 'pi' ? {
                    streamFn: createProviderStream(connection, { fetch: guardedFetch }),
                    model: createProviderModel(connection), capabilityResolver: providerCapabilities,
                } : {}) });
                adapter.preflight?.({ connection });
                const result = await adapter.runTurn({ snapshot: { id: 'explicit-live-connection-check' }, connection,
                    requestPlan: { type: 'send', sourceRefs: [], messages: [{ role: 'system', content: 'This is a connection test. Reply with exactly OK. Do not use tools.' }, { role: 'user', content: 'Reply OK.' }] },
                    tools: [], limits: { rounds: 1, turnTimeoutMs: 45000, maxOutputTokens }, signal: AbortSignal.timeout(45000),
                    beforeRequest(actual) { if (!Number.isSafeInteger(actual.estimatedTokens) || actual.estimatedTokens > connection.workingBudget) throw Object.assign(new Error(), { code: 'live-input-budget' }); },
                    onEvent(event) { if (event.type === 'usage.updated') events.push(event.usage); },
                });
                assert.equal(executorRequests, 1);
                assert.equal(result.finishReason, 'stop');
                if (kind !== 'pi') {
                    assert.equal(result.capabilities.historyMode, 'native-transcript');
                    assert.equal(result.capabilities.budgetEnforcement, 'gateway-every-request');
                    assert.equal(result.capabilities.security.enforced, true);
                }
                results.push({ executor: kind, isolation: kind === 'pi' ? 'not-applicable' : result.capabilities.security,
                    isolationDenialTests: 'not-run', thinkingBudget: 'unsupported-by-deepseek', status: result.content.trim() === 'OK' ? 'passed' : 'failed', outputMatched: result.content.trim() === 'OK', finishReason: result.finishReason,
                    requests: dispatched - before, elapsedMs: Date.now() - started,
                    usage: Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'].map(key => [key, Number.isFinite(result.usage?.[key]) ? result.usage[key] : null])), usageEvents: events.length });
            } catch (error) { results.push({ executor: kind, status: 'failed', code: error.code ?? 'execution-failed', requests: dispatched - before, elapsedMs: Date.now() - started }); }
        }
        console.log(JSON.stringify({ endpointHost: endpoint.hostname, configuredModel: settings.custom_model, dispatched, results }, null, 2));
        if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
    } catch (error) { console.log(JSON.stringify({ status: 'blocked', code: error.code ?? 'configuration-read-failed', dispatched, results })); process.exitCode = 2; }
}

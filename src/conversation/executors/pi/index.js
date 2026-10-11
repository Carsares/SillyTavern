import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { TOOL_LIMITS } from '../../../../public/shared/conversation/schemas/index.js';
import { getCapabilities, validateCapabilities, reasoningEffort } from '../../capabilities/core/index.js';
import { createCapturedFetch, createRedactor, estimateContext, estimatePiContext, fail } from '../../providers/core/index.js';
import { createPrimaryModel, createPrimaryStream, samplingParameters } from '../../providers/primary/index.js';
import { toPiMessages, toPiContent } from './messages.js';

export { getCapabilities };
export { createPiStreamBridge } from './bridge.js';

/** Uses pi 1.0.2's Agent loop; stream/model injection changes transport, never scheduling. */
export function createPiExecutor({ onRequest, streamFn, model: injectedModel, fetch: fetchImpl, capabilityResolver = getCapabilities, modelFactory = createPrimaryModel } = {}) {
    return {
        async runTurn({ requestPlan, connection, tools = [], limits = {}, signal, beforeRequest, onEvent }) {
            const c = connection?.data ?? connection;
            const capabilities = validateCapabilities(c, capabilityResolver(c));
            if (!capabilities.supported) throw fail('unsupported-capability', capabilities.reason);
            const type = requestPlan?.type ?? 'send';
            if (!capabilities.types.includes(type)) throw fail('unsupported-type', 'Unsupported generation type');
            const bounds = { ...TOOL_LIMITS, ...limits };
            for (const key of ['rounds', 'callsPerRound', 'resultBytes', 'timeoutMs', 'turnTimeoutMs']) {
                if (!Number.isSafeInteger(bounds[key]) || bounds[key] <= 0) throw fail('invalid-limits', `Invalid ${key} limit`);
            }
            const outputLimit = bounds.maxOutputTokens ?? c.maxOutputTokens;
            if (!Number.isSafeInteger(outputLimit) || outputLimit <= 0 || outputLimit > c.maxOutputTokens || outputLimit > capabilities.outputLimit) throw fail('invalid-limits', 'Invalid output token limit');
            const inputBudget = Math.min(capabilities.inputLimit, c.contextWindow - outputLimit, c.workingBudget);
            const model = injectedModel ?? modelFactory(c, capabilities);
            if (!model || typeof model.api !== 'string' || !model.api || model.id !== c.model) throw fail('unsupported-model', 'Injected model must match the selected connection');
            if (!streamFn && model.api !== 'openai-completions') throw fail('unsupported-model', 'A custom model API requires an injected streamFn');
            if (tools.length && !capabilities.tools) throw fail('unsupported-tools', 'This provider does not support tools');
            const messages = toPiMessages(requestPlan?.messages, model, capabilities);
            if (!capabilities.tools && messages.some(m => m.role === 'toolResult' || Array.isArray(m.content) && m.content.some(p => p.type === 'toolCall'))) throw fail('unsupported-tools', 'Tool history is unsupported');
            const parameters = streamFn ? undefined : samplingParameters(c.parameters);
            const redact = createRedactor(c);
            const controller = new AbortController();
            const effectiveSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            let agent, fatal, requests = 0, calls = 0, content = '', reasoning = '', finishReason = 'stop';
            const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0, totalTokens: 0, complete: false, cost: null, requests: [] };
            function check() { if (fatal) throw fatal; effectiveSignal.throwIfAborted(); }
            function stop(error) { fatal ??= error; controller.abort(); agent?.abort(); }
            let timer;
            async function emit(event) {
                check();
                try { await onEvent?.(redact(event)); }
                catch { const error = fail('event-persistence-failed', 'Could not persist the executor event'); stop(error); throw error; }
                check();
            }
            const sdkTools = tools.map(tool => {
                if (!tool?.name || typeof tool.execute !== 'function' || !tool.parameters || tool.parameters.type !== 'object') throw fail('invalid-tool', 'Tools require a name, object schema and execute wrapper');
                return {
                    name: tool.name, label: tool.name, description: tool.description ?? '',
                    parameters: Type.Unsafe(structuredClone(tool.parameters)), executionMode: 'sequential', replay: 'never',
                    async execute(callId, args, sdkSignal) {
                        check();
                        const timeout = new AbortController();
                        const toolSignal = AbortSignal.any([effectiveSignal, sdkSignal ?? effectiveSignal, timeout.signal]);
                        let abortListener;
                        const taskTimer = setTimeout(() => timeout.abort(), bounds.timeoutMs);
                        try {
                            const aborted = new Promise((_, reject) => {
                                abortListener = () => reject(toolSignal.reason);
                                toolSignal.addEventListener('abort', abortListener, { once: true });
                                if (toolSignal.aborted) abortListener();
                            });
                            const result = await Promise.race([Promise.resolve().then(() => { toolSignal.throwIfAborted(); return tool.execute(callId, args, toolSignal); }), aborted]);
                            check();
                            if (Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8') > bounds.resultBytes) {
                                const error = fail('tool-result-limit', 'Tool result exceeds the configured byte limit'); stop(error); throw error;
                            }
                            if (result && Array.isArray(result.content)) {
                                const resultContent = toPiContent(result.content, capabilities);
                                if (resultContent.some(p => !['text', 'image'].includes(p.type))) throw fail('unsupported-content', 'Invalid tool result blocks');
                                return { ...result, content: resultContent, details: result.details ?? null };
                            }
                            return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) ?? 'null' }], details: result ?? null };
                        } catch (error) {
                            if (toolSignal.aborted) { stop(fail(timeout.signal.aborted ? 'tool-timeout' : 'aborted', 'Tool execution stopped; external effects may be unknown')); throw fatal; }
                            // Do not let SDK embed raw exception text (which may contain credentials) in history.
                            throw fail('tool-failed', 'Tool execution failed');
                        } finally {
                            clearTimeout(taskTimer);
                            if (abortListener) toolSignal.removeEventListener('abort', abortListener);
                        }
                    },
                };
            });
            if (new Set(sdkTools.map(t => t.name)).size !== sdkTools.length) throw fail('invalid-tool', 'Duplicate tool names');
            const capturedFetch = createCapturedFetch({ fetchImpl, redact, check, onRequest: async trace => {
                try { await onRequest?.({ ...trace, requestIndex: requests }); }
                catch { stop(fail('request-capture-failed', 'Could not persist the request capture')); throw fatal; }
            } });
            const stream = streamFn ?? createPrimaryStream(c, model);
            const abortAgent = () => agent?.abort();
            try {
                timer = setTimeout(() => stop(fail('turn-timeout', 'Turn deadline exceeded')), bounds.turnTimeoutMs);
                check();
                agent = new Agent({
                    initialState: { model, messages: [], tools: sdkTools, thinkingLevel: reasoningEffort(c) },
                    toolExecution: 'sequential',
                    async prepareRequest({ context }) {
                        try {
                            check();
                            if (++requests > bounds.rounds + 1) throw fail('request-limit', 'Model request limit exceeded');
                            calls = 0;
                            // The callback sees a copy of SDK history, including tool results/declarations.
                            const actual = { ...requestPlan, messages: structuredClone(context.messages), estimatedTokens: estimatePiContext(context.messages, capabilities), estimationMethod: 'utf8-byte-upper-bound-with-verified-media', mediaTokenCost: capabilities.mediaTokenCost, mediaTokenCostVerified: capabilities.verified === true, budget: { hardInputBudget: Math.min(capabilities.inputLimit, c.contextWindow - outputLimit), workingBudget: inputBudget }, requestIndex: requests, signal: effectiveSignal };
                            await beforeRequest?.(actual);
                            check();
                            if (!beforeRequest && estimatePiContext(context.messages, capabilities) > inputBudget) throw fail('budget-blocked', 'Actual SDK context exceeds the input budget');
                        } catch (error) {
                            stop(effectiveSignal.aborted ? fail('aborted', 'Turn aborted') : error?.name === 'ProtocolError' ? fail(error.code, redact(error.message)) : fail('before-request-failed', 'Before-request validation failed'));
                            throw fatal;
                        }
                    },
                    streamFn: (activeModel, context, options) => {
                        check();
                        return stream(activeModel, context, { ...options, maxTokens: outputLimit, maxRetries: 0, timeoutMs: bounds.turnTimeoutMs, transport: 'sse', samplingParams: parameters, fetch: capturedFetch,
                            async onPayload(payload) {
                                check();
                                if (!beforeRequest && !capabilities.media.includes('image') && estimateContext(payload) > inputBudget) { stop(fail('budget-blocked', 'Serialized provider payload exceeds the input budget')); throw fatal; }
                            },
                            async onProviderStreamEvent(raw) {
                                check();
                                if (raw?.usage) {
                                    rawUsage = structuredClone(raw.usage);
                                }
                            },
                        });
                    },
                    async beforeToolCall({ assistantMessage }) {
                        check();
                        if (++calls > bounds.callsPerRound || assistantMessage.content.filter(p => p.type === 'toolCall').length > bounds.callsPerRound || requests > bounds.rounds) {
                            stop(fail('tool-limit', 'Tool call or round limit exceeded'));
                            return { block: true, reason: 'Tool limit exceeded', terminate: true };
                        }
                    },
                    finishTurn() { if (fatal || effectiveSignal.aborted) return { action: 'end' }; },
                });
                let rawUsage;
                agent.subscribe(async event => {
                    if (fatal || effectiveSignal.aborted) return;
                    if (event.type === 'turn_start') rawUsage = undefined;
                    if (event.type === 'message_update') {
                        const delta = event.assistantMessageEvent;
                        if (delta.type === 'text_delta') { content += delta.delta; await emit({ type: 'text.delta', text: delta.delta }); }
                        if (delta.type === 'thinking_delta') { reasoning += delta.delta; await emit({ type: 'reasoning.delta', text: delta.delta }); }
                    } else if (event.type === 'tool_execution_start') {
                        await emit({ type: 'tool.call', toolCallId: event.toolCallId, name: event.toolName, args: event.args });
                    } else if (event.type === 'tool_execution_end') {
                        await emit({ type: 'tool.result', toolCallId: event.toolCallId, name: event.toolName, result: event.result, isError: event.isError });
                    } else if (event.type === 'message_end' && event.message.role === 'assistant' && requests > 0) {
                        const message = event.message;
                        finishReason = message.stopReason;
                        if (finishReason === 'error') stop(fail('provider-error', 'Model request failed'));
                        else if (finishReason === 'aborted') stop(fail('aborted', 'Model request aborted'));
                        else if (!['stop', 'length', 'toolUse'].includes(finishReason)) stop(fail('unsupported-finish', 'Unsupported provider completion state'));
                        if (fatal) return;
                        const u = message.usage;
                        const known = value => Number.isFinite(value) && value >= 0 ? value : null;
                        const add = (total, value) => total === null || known(value) === null ? null : total + value;
                        const entry = { requestIndex: requests, model: message.model, responseModel: message.responseModel, normalized: u ? { input: known(u.input), output: known(u.output), cacheRead: known(u.cacheRead), cacheWrite: known(u.cacheWrite), totalTokens: known(u.totalTokens), reasoning: known(u.reasoning), cacheWrite1h: known(u.cacheWrite1h) } : null, raw: rawUsage ?? null, cost: null };
                        usage.requests.push(entry);
                        usage.inputTokens = add(usage.inputTokens, u?.input); usage.outputTokens = add(usage.outputTokens, u?.output);
                        usage.cacheReadTokens = add(usage.cacheReadTokens, u?.cacheRead); usage.cacheWriteTokens = add(usage.cacheWriteTokens, u?.cacheWrite); usage.totalTokens = add(usage.totalTokens, u?.totalTokens);
                        usage.reasoningTokens = add(usage.reasoningTokens, u?.reasoning); usage.cacheWrite1hTokens = add(usage.cacheWrite1hTokens, u?.cacheWrite1h);
                        usage.complete = usage.requests.every(r => (Number.isFinite(r.raw?.prompt_tokens) && Number.isFinite(r.raw?.completion_tokens)) || (Number.isFinite(r.raw?.inputTokens) && Number.isFinite(r.raw?.outputTokens)) || (Number.isFinite(r.raw?.input_tokens) && Number.isFinite(r.raw?.output_tokens)));
                        await emit({ type: 'usage.updated', usage: structuredClone(usage) });
                    }
                });
                effectiveSignal.addEventListener('abort', abortAgent, { once: true });
                check();
                await agent.prompt(messages);
                check();
                if (!usage.requests.length) throw fail('provider-error', 'Model returned no completed message');
                return redact({ content, reasoning, usage, finishReason });
            } catch (error) {
                if (fatal) throw fatal;
                if (effectiveSignal.aborted) throw fail('aborted', 'Turn aborted');
                // Preserve local validation codes, never provider exceptions or connection secrets.
                if (error?.name === 'ProtocolError') throw fail(error.code, redact(error.message));
                throw fail('executor-error', 'PI execution failed');
            } finally {
                clearTimeout(timer);
                effectiveSignal.removeEventListener('abort', abortAgent);
                agent?.abort();
                await agent?.waitForIdle();
            }
        },
    };
}

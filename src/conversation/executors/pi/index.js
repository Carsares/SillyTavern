import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { TOOL_LIMITS } from '../../../../public/shared/conversation/schemas/index.js';
import { getCapabilities, validateCapabilities, reasoningEffort } from '../../capabilities/core/index.js';
import { createCapturedFetch, createRedactor, estimateContext, estimatePiContext, fail } from '../../providers/core/index.js';
import { createPrimaryModel, createPrimaryStream, samplingParameters } from '../../providers/primary/index.js';
import { toPiMessages, toPiContent } from './messages.js';

import { normalizePiUsage, updatePiUsage, usageSemantics } from './usage.js';

export { getCapabilities };
export { createPiStreamBridge } from './bridge.js';

/** Uses pi 1.0.2's Agent loop; stream/model injection changes transport, never scheduling. */
export function createPiExecutor({ onRequest, streamFn, model: injectedModel, fetch: fetchImpl, capabilityResolver = getCapabilities, modelFactory = createPrimaryModel } = {}) {
    return {
        async runTurn({ requestPlan, connection, tools = [], limits = {}, signal, beforeRequest, onEvent }) {
            const c = connection?.data ?? connection;
            const capabilities = validateCapabilities(c, capabilityResolver(c));
            if (!capabilities.supported) throw fail('unsupported-capability', capabilities.reason);
            const providerReasoning = Array.isArray(capabilities.reasoning);
            if (providerReasoning && !streamFn && reasoningEffort(c) !== 'off') throw fail('unsupported-reasoning', 'Provider-native reasoning requires an injected protocol stream');
            const type = requestPlan?.type ?? 'send';
            if (!capabilities.types.includes(type)) throw fail('unsupported-type', 'Unsupported generation type');
            const bounds = { ...TOOL_LIMITS, ...limits };
            for (const key of ['rounds', 'callsPerRound', 'resultBytes', 'timeoutMs', 'turnTimeoutMs']) {
                if (!Number.isSafeInteger(bounds[key]) || bounds[key] <= 0) throw fail('invalid-limits', `Invalid ${key} limit`);
            }
            const outputLimit = bounds.maxOutputTokens ?? c.maxOutputTokens;
            if (!Number.isSafeInteger(outputLimit) || outputLimit <= 0 || outputLimit > c.maxOutputTokens || outputLimit > capabilities.outputLimit) throw fail('invalid-limits', 'Invalid output token limit');
            const inputBudget = Math.min(capabilities.inputLimit, c.contextWindow - outputLimit, c.workingBudget, requestPlan?.budget?.workingBudget ?? Infinity);
            if (!Number.isSafeInteger(inputBudget) || inputBudget <= 0) throw fail('budget-blocked', 'Compiled input budget must be a positive integer');
            if (c.parameters?.negative_prompt !== undefined && (typeof c.parameters.negative_prompt !== 'string' || estimateContext(c.parameters.negative_prompt) > inputBudget)) throw fail('budget-blocked', 'Negative context exceeds the input budget with output reserve');
            const model = injectedModel ?? modelFactory(c, capabilities);
            if (!model || typeof model.api !== 'string' || !model.api || model.id !== c.model) throw fail('unsupported-model', 'Injected model must match the selected connection');
            if (!streamFn && model.api !== 'openai-completions') throw fail('unsupported-model', 'A custom model API requires an injected streamFn');
            if (!streamFn && capabilities.media.some(type => !['text', 'image'].includes(type))) throw fail('unsupported-media', 'Extended media requires a protocol stream');
            if (tools.length && !capabilities.tools) throw fail('unsupported-tools', 'This provider does not support tools');
            if (model.providerMedia && capabilities.media.some(type => !model.providerMedia.includes(type))) throw fail('unsupported-media', 'Provider model media does not match capabilities');
            const messages = toPiMessages(requestPlan?.messages, model, capabilities);
            const mediaReserve = messages.reduce((sum, message) => sum + (message.providerParts ?? message.content ?? []).reduce((cost, part) => cost + (['image', 'audio', 'video', 'document'].includes(part.type) ? capabilities.mediaTokenCost[part.type] : 0), 0), 0);
            function checkTextContext(value) {
                if (value !== undefined && (typeof value !== 'string' || estimateContext(value) + mediaReserve > inputBudget)) throw fail('budget-blocked', 'Text context and media exceed the input budget with output reserve');
            }
            checkTextContext(c.parameters?.negative_prompt);
            if (c.type === 'text') checkTextContext(requestPlan.prompt);
            if (!capabilities.tools && messages.some(m => m.role === 'toolResult' || Array.isArray(m.content) && m.content.some(p => p.type === 'toolCall'))) throw fail('unsupported-tools', 'Tool history is unsupported');
            const parameters = streamFn ? undefined : samplingParameters(c.parameters);
            const redact = createRedactor(c);
            const controller = new AbortController();
            const effectiveSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            let outputMedia = [];
            let agent, fatal, requests = 0, calls = 0, content = '', reasoning = '', finishReason = 'stop';
            const usage = { ...usageSemantics, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: 0, totalTokens: 0, complete: false, cost: null, costUsd: null, costSource: null, costEstimated: null, requests: [] };
            function check() { if (fatal) throw fatal; effectiveSignal.throwIfAborted(); }
            function stop(error) { fatal ??= error; controller.abort(); agent?.abort(); }
            let timer;
            async function emit(event) {
                check();
                try { await onEvent?.(redact(event)); } catch { const error = fail('event-persistence-failed', 'Could not persist the executor event'); stop(error); throw error; }
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
                                const resultContent = toPiContent(result.providerParts ?? result.content, capabilities);
                                if (resultContent.some(p => !['text', 'image', 'audio', 'video', 'document'].includes(p.type))) throw fail('unsupported-content', 'Invalid tool result blocks');
                                return { ...result, ...(result.providerParts || resultContent.some(part => ['audio', 'video', 'document'].includes(part.type)) ? { providerParts: resultContent } : {}), content: resultContent, details: result.details ?? null };
                            }
                            return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) ?? 'null' }], details: result ?? null };
                        } catch (error) {
                            if (['tool-result-unknown', 'tool-persistence-failed'].includes(error?.code)) {
                                stop(fail(error.code, 'Tool outcome is unknown; automatic continuation is blocked'));
                                throw fatal;
                            }
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
            function checkWireSize(bytes) {
                // Media uses verified token reserves, not base64 byte length. Text-only
                // requests can additionally be checked at the final transport boundary.
                if (mediaReserve === 0 && bytes + 64 > inputBudget) {
                    stop(fail('budget-blocked', 'Serialized provider payload exceeds the input budget'));
                    throw fatal;
                }
            }
            const capturedFetch = createCapturedFetch({ fetchImpl, redact, check, beforeDispatch: text => checkWireSize(Buffer.byteLength(text, 'utf8')), onRequest: async trace => {
                try { await onRequest?.({ ...trace, requestIndex: requests }); } catch { stop(fail('request-capture-failed', 'Could not persist the request capture')); throw fatal; }
            } });
            const stream = streamFn ?? createPrimaryStream(c, model);
            const abortAgent = () => agent?.abort();
            try {
                timer = setTimeout(() => stop(fail('turn-timeout', 'Turn deadline exceeded')), bounds.turnTimeoutMs);
                check();
                agent = new Agent({
                    initialState: { model, messages: [], tools: sdkTools, thinkingLevel: providerReasoning ? 'off' : reasoningEffort(c) },
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
                            if (actual.estimatedTokens > inputBudget) throw fail('budget-blocked', 'Actual SDK context exceeds the input budget');
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
                                try { checkTextContext(payload.negative_prompt); if (c.type === 'text') checkTextContext(payload.prompt ?? payload.input); } catch (error) { stop(error); throw fatal; }
                                checkWireSize(Buffer.byteLength(JSON.stringify(payload), 'utf8'));
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
                        rawUsage = message.providerUsage ?? rawUsage;
                        if (message.media) { if (!Array.isArray(message.media)) throw fail('unsupported-media', 'Provider output media must be an array'); outputMedia = structuredClone(message.media); }
                        const normalized = normalizePiUsage(message, rawUsage, { provider: c.provider, sdkEstimated: model.costSource === 'sdk-estimated' });
                        const entry = { ...normalized, requestIndex: requests, model: message.model, responseModel: message.responseModel,
                            normalized: { input: normalized.inputTokens, output: normalized.outputTokens, cacheRead: normalized.cacheReadTokens,
                                cacheWrite: normalized.cacheWriteTokens, totalTokens: normalized.totalTokens, reasoning: normalized.reasoningTokens,
                                cacheWrite1h: normalized.cacheWrite1hTokens, ...usageSemantics } };
                        updatePiUsage(usage, entry);
                        await emit({ type: 'usage.updated', usage: structuredClone(usage) });
                    }
                });
                effectiveSignal.addEventListener('abort', abortAgent, { once: true });
                check();
                await agent.prompt(messages);
                check();
                if (!usage.requests.length) throw fail('provider-error', 'Model returned no completed message');
                return { ...redact({ content, reasoning, usage, finishReason }), ...(outputMedia.length ? { media: outputMedia } : {}) };
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

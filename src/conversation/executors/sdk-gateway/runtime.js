import { createConnectionFetch } from '../../providers/core/proxy.js';
import { createSdkGateway } from './index.js';
import { createRestrictedEnvironment, loadSdk } from './environment.js';
import { fail, metadata, positiveLimit, preflight } from './contracts.js';
import { createTranscript, encodeHistory } from './history.js';

/** SDK owns the loop; this layer owns one turn's processes and gateway. */
export function createSdkExecutor(executor, dependencies, execute) {
    const { sdk: injectedSdk, gatewayFactory = createSdkGateway, environmentFactory = createRestrictedEnvironment,
        onRequest, fetch, countTokens } = dependencies;
    return {
        getCapabilities(connection) {
            const info = { ...metadata(executor), implemented: true, tools: true, media: ['text'],
                securityStatus: 'profile-implemented-sdk-runtime-unverified', sdkRuntimeVerified: false,
                budgetMeasurement: countTokens ? 'injected-counter' : 'conservative-estimate' };
            try {
                const configured = preflight(executor, { connection });
                if (process.platform !== 'darwin' && environmentFactory === createRestrictedEnvironment) throw fail('unsupported-isolation-platform', 'This platform needs a restricted environmentFactory');
                return { ...info, ...configured, budgetMeasurement: info.budgetMeasurement, supported: true, types: ['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group'] };
            } catch (error) { return { ...info, supported: false, types: [], reason: error.code ?? 'invalid-connection' }; }
        },
        preflight: args => preflight(executor, args),
        async runTurn(args) {
            const capabilities = preflight(executor, args);
            capabilities.budgetMeasurement = countTokens ? 'injected-counter' : 'conservative-estimate';
            const transcript = createTranscript(args.snapshot, args.requestPlan, capabilities.historyMode);
            if (capabilities.nativeHistory) encodeHistory(transcript.messages, executor === 'claude' ? 'anthropic' : 'responses');
            const prompt = transcript.prompt;
            const connection = structuredClone(args.connection?.data ?? args.connection);
            const limits = args.limits ?? {};
            const timeoutMs = positiveLimit(limits.turnTimeoutMs, 180000, 'turnTimeoutMs');
            const controller = new AbortController();
            const onAbort = () => controller.abort();
            args.signal?.addEventListener('abort', onAbort, { once: true });
            if (args.signal?.aborted) controller.abort();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            let gateway, environment, cleanupSdk, gatewayAbort, outcome, failure, transport;
            try {
                controller.signal.throwIfAborted();
                if (connection.proxy && fetch === globalThis.fetch) throw fail('invalid-transport', 'Native fetch cannot honor a configured proxy', 422);
                if (fetch === undefined) transport = createConnectionFetch(connection);
                const sdk = injectedSdk ?? await loadSdk(executor);
                gateway = gatewayFactory({ protocol: executor === 'claude' ? 'anthropic' : 'responses', connection,
                    tools: args.tools ?? [], limits, signal: controller.signal, fetch: fetch ?? transport.fetch, countTokens,
                    inputBudget: capabilities.inputBudget, maxOutputTokens: capabilities.maxOutputTokens, transcript,
                    beforeRequest: args.beforeRequest, onRequest, onEvent: args.onEvent });
                gatewayAbort = () => controller.abort();
                gateway.signal.addEventListener('abort', gatewayAbort, { once: true });
                const address = await gateway.start();
                controller.signal.throwIfAborted();
                environment = await environmentFactory({ executor, gateway: address, signal: controller.signal });
                transcript.sdkEnvironmentText = environment.claudeEnvironmentText?.(connection.model);
                if (!environment.security?.enforced) throw fail('isolation-required', 'SDK process requires an enforced OS isolation backend', 503);
                await args.onEvent?.({ type: 'executor.metadata', capabilities: { ...capabilities, security: environment.security } });
                controller.signal.throwIfAborted();
                const finishReason = await execute({ sdk, environment, address, gateway, controller, connection,
                    tools: args.tools ?? [], limits, prompt, setCleanup(fn) { cleanupSdk = fn; } });
                gateway.check();
                const result = gateway.result();
                if (!result.usage.requests.length || result.usage.requests.some(r => !r.complete)) throw fail('incomplete-sdk-turn', 'SDK did not complete a gateway-controlled model request', 502);
                if (result.toolStates.some(tool => tool.state !== 'completed')) throw fail('incomplete-sdk-tools', 'SDK ended with unresolved domain tool calls', 502);
                outcome = { ...result, finishReason, capabilities: { ...capabilities, security: environment.security } };
            } catch (error) {
                // A gateway failure identifies the cause of an SDK cancellation.
                try { gateway?.check(); } catch (gatewayError) { failure = gatewayError; }
                failure ??= controller.signal.aborted
                    ? fail('aborted', 'SDK turn stopped; external effects may be unknown')
                    : error?.name === 'ProtocolError' ? error : fail('sdk-execution-failed', 'SDK execution failed', 502);
            } finally {
                clearTimeout(timer);
                args.signal?.removeEventListener('abort', onAbort);
                if (gatewayAbort) gateway.signal.removeEventListener('abort', gatewayAbort);
                controller.abort();
                const errors = [];
                for (const close of [cleanupSdk, () => environment?.close(), () => gateway?.close(), () => transport?.close()]) {
                    try { await close?.(); } catch { errors.push(true); }
                }
                if (errors.length) failure ??= fail('sdk-shutdown-incomplete', 'One or more SDK resources failed to close', 503);
            }
            if (failure) throw failure;
            return outcome;
        },
    };
}

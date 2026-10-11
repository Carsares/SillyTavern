import { createSdkExecutor } from '../sdk-gateway/runtime.js';
import { fail, historyInstructions, positiveLimit } from '../sdk-gateway/contracts.js';
import { reasoningControls } from '../sdk-gateway/reasoning.js';

export function createClaudeExecutor(dependencies = {}) {
    return createSdkExecutor('claude', dependencies, async ({ sdk, environment, address, gateway, controller, connection, tools, limits, prompt, setCleanup }) => {
        const query = sdk.query({ prompt, options: {
            model: connection.model, systemPrompt: historyInstructions(connection.historyMode),
            ...reasoningControls('claude', connection.reasoning, limits.maxOutputTokens ?? connection.maxOutputTokens).sdk,
            cwd: environment.directory, env: environment.env,
            pathToClaudeCodeExecutable: environment.claudeExecutable,
            spawnClaudeCodeProcess: environment.spawnClaudeCodeProcess,
            abortController: controller, persistSession: false, includePartialMessages: true,
            tools: [], allowedTools: tools.map(t => `mcp__domain__${t.name}`),
            settingSources: [], skills: [], plugins: [], strictMcpConfig: true,
            permissionMode: 'dontAsk', verbatimPrompts: true,
            promptSuggestions: false, agentProgressSummaries: false,
            maxTurns: positiveLimit(limits.rounds, 5, 'rounds') + 1,
            mcpServers: tools.length ? { domain: { type: 'http', url: address.mcpUrl, headers: { Authorization: `Bearer ${address.token}` } } } : {},
            canUseTool: async (name, input) => tools.some(t => name === `mcp__domain__${t.name}`)
                ? { behavior: 'allow', updatedInput: input }
                : { behavior: 'deny', message: 'Only domain tools are available' },
        } });
        setCleanup(async () => { query.close(); await query.return?.(); });
        let succeeded = false;
        for await (const message of query) {
            gateway.check();
            if (message.type === 'result') {
                if (message.is_error || message.subtype !== 'success') throw fail('sdk-turn-failed', 'Claude SDK reported an unsuccessful turn', 502);
                succeeded = true;
            }
        }
        if (!succeeded) throw fail('incomplete-sdk-turn', 'Claude SDK ended without success', 502);
        return 'stop';
    });
}

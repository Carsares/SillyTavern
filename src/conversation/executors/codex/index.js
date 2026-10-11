import { createSdkExecutor } from '../sdk-gateway/runtime.js';
import { fail } from '../sdk-gateway/contracts.js';
import { reasoningControls } from '../sdk-gateway/reasoning.js';

// Keys checked against rust-v0.160.0/codex-rs/core/config.schema.json.
// Flags narrow the SDK; gateway tool checks and the OS sandbox are mandatory.
export function codexProcessConfig({ address, tools }) {
    return {
        model_provider: 'conversation_gateway',
        model_providers: { conversation_gateway: {
            name: 'Conversation gateway', base_url: `${address.baseUrl}/v1`, wire_api: 'responses',
            env_key: 'CODEX_API_KEY', requires_openai_auth: false, supports_websockets: false,
            request_max_retries: 0, stream_max_retries: 0,
        } },
        cli_auth_credentials_store: 'file', history: { persistence: 'none' },
        analytics: { enabled: false }, feedback: { enabled: false },
        project_doc_max_bytes: 0, web_search: 'disabled',
        features: {
            shell_tool: false, unified_exec: false, apply_patch_freeform: false,
            js_repl: false, code_mode: false, code_mode_host: false,
            apps: false, connectors: false, computer_use: false, browser_use: false,
            image_generation: false, memories: false, memory_tool: false,
            multi_agent: false, multi_agent_v2: false, hooks: false, codex_hooks: false,
            enable_request_compression: false, non_prefixed_mcp_tool_names: false,
        },
        mcp_servers: tools.length ? { domain: {
            url: address.mcpUrl, http_headers: { Authorization: `Bearer ${address.token}` },
            enabled_tools: tools.map(t => t.name), required: true,
        } } : {},
    };
}

export function createCodexExecutor(dependencies = {}) {
    return createSdkExecutor('codex', dependencies, async ({ sdk, environment, address, gateway, controller, connection, tools, prompt, setCleanup }) => {
        const codex = new sdk.Codex({ codexPathOverride: environment.codexPathOverride,
            baseUrl: `${address.baseUrl}/v1`, apiKey: address.token, env: environment.env,
            config: codexProcessConfig({ address, tools }) });
        const thread = codex.startThread({ model: connection.model, workingDirectory: environment.directory,
            ...reasoningControls('codex', connection.reasoning, connection.maxOutputTokens).sdk,
            skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never',
            networkAccessEnabled: false, webSearchMode: 'disabled' });
        const { events } = await thread.runStreamed(prompt, { signal: controller.signal });
        setCleanup(async () => { await events.return?.(); });
        let succeeded = false;
        for await (const event of events) {
            gateway.check();
            if (['command_execution', 'file_change', 'web_search'].includes(event.item?.type)) throw fail('forbidden-sdk-tool', 'SDK attempted a host tool despite restrictions', 422);
            if (['turn.failed', 'error'].includes(event.type)) throw fail('sdk-turn-failed', 'Codex SDK reported an unsuccessful turn', 502);
            if (event.type === 'turn.completed') succeeded = true;
        }
        if (!succeeded) throw fail('incomplete-sdk-turn', 'Codex SDK ended without success', 502);
        return 'stop';
    });
}

import { TOOL_LIMITS } from '../../shared/conversation/schemas/index.js';
import { describeAgentError } from './chat-agent-errors.js';

// Page-local presentation only. Conversations and turns remain owned by the Agent backend.
const views = new WeakMap();

export function getChatAgentState(state) {
    if (!views.has(state)) views.set(state, { sessions: new Map(), active: null, busy: false });
    return views.get(state);
}

export function getChatAgentSession(state, contextKey) {
    return getChatAgentState(state).sessions.get(contextKey);
}

export function agentErrorMessage(error) {
    try {
        const message = describeAgentError(JSON.parse(error.body).error);
        if (message) return message;
    } catch { /* Ordinary client errors have no JSON body. */ }
    return error.message || 'Agent 请求失败';
}

export const AGENT_API = '/api/conversation/v1';
export const agentTurnTerminal = status => ['completed', 'failed', 'stopped', 'interrupted'].includes(status);

// The server fails a turn once the conversation's turnTimeoutMs has passed (clamped to 1 s – 1 h by
// src/conversation/runtime/index.js, default TOOL_LIMITS.turnTimeoutMs). The page waits that long plus a
// margin for the server to persist the end, so it does not give up on a turn the server still runs.
const turnEndMarginMs = 30000;

/** @param {{ settings?: { turnTimeoutMs?: number } } | null | undefined} snapshot */
export function agentTurnWaitMs(snapshot) {
    const configured = snapshot?.settings?.turnTimeoutMs;
    const turnTimeoutMs = Number.isFinite(configured) ? Math.min(Math.max(configured, 1000), 3600000) : TOOL_LIMITS.turnTimeoutMs;
    return turnTimeoutMs + turnEndMarginMs;
}

// Editor selections are not applied settings. Only the actual chat entity and its
// explicit persona/book overrides are sent; the server resolves saved configuration.
export function currentAgentSelection(entity, metadata = {}, executor = 'pi') {
    if (!entity?.avatar) throw new Error('原群聊暂不直接转为 Agent 会话；可在 Agent 工作区创建群聊。');
    if (!['pi', 'claude', 'codex'].includes(executor)) throw new Error('请选择 PI、Claude 或 Codex 执行器。');
    return {
        schemaVersion: 1,
        executor,
        characterId: entity.avatar,
        title: `Agent · ${entity.name || entity.data?.name || entity.avatar}`,
        ...(metadata.persona ? { personaId: metadata.persona } : {}),
        ...(metadata.world_info ? { chatWorldbookId: metadata.world_info } : {}),
    };
}

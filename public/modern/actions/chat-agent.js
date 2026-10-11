import { AGENT_API, agentErrorMessage, agentTurnTerminal, currentAgentSelection, getChatAgentState } from '../core/chat-agent-state.js';

export function createChatAgentActions({ state, apiFetch, render, getSelectedChatEntity, getChatContextKey, getChatCacheKey, isGroupChatMode,
    waitForEngineSync = async () => ({ settled: true }), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
    requestId = () => crypto.randomUUID(), pollMs = 750, watchMs = 120000 }) {
    const view = getChatAgentState(state);
    const current = () => view.sessions.get(getChatContextKey());
    const path = id => `${AGENT_API}/conversations/${encodeURIComponent(id)}`;
    const request = (url, options = {}) => apiFetch(url, options, false);

    function setChatAgentMode(enabled) {
        if (view.busy || state.engine.generating) throw new Error('请等待当前生成结束后切换模式。');
        if (enabled && isGroupChatMode()) throw new Error('原群聊暂不直接转为 Agent 会话；可在 Agent 工作区创建群聊。');
        const key = getChatContextKey();
        if (!getSelectedChatEntity()) throw new Error('请先选择角色。');
        if (!view.sessions.has(key)) view.sessions.set(key, { enabled: false, executor: 'pi', draft: '', snapshot: null, conversationId: '', pending: null, turn: null, error: '' });
        current().enabled = enabled;
        render();
    }

    function setChatAgentDraft(text) {
        if (current()) current().draft = text;
    }

    function setChatAgentExecutor(executor) {
        const session = current();
        if (!session || session.conversationId || view.busy || state.engine.generating) throw new Error('请在新会话首次发送前选择执行器。');
        if (!['pi', 'claude', 'codex'].includes(executor)) throw new Error('不支持该执行器。');
        session.executor = executor;
        render();
    }

    function release(session) {
        if (view.active !== session) return;
        view.active = null;
        state.engine.generating = false;
    }

    async function read(session) {
        session.snapshot = await request(path(session.conversationId), { method: 'GET' });
        const turnId = session.snapshot.conversation.activeTurnId || session.turn?.id;
        if (turnId) session.turn = await request(`${AGENT_API}/turns/${encodeURIComponent(turnId)}`, { method: 'GET' });
        if (session.turn && agentTurnTerminal(session.turn.status)) {
            session.snapshot = await request(path(session.conversationId), { method: 'GET' });
            if (session.pending && session.draft.trim() === session.pending.content) session.draft = '';
            session.pending = null;
            release(session);
            session.error = session.turn.error?.message || '';
        }
        render();
    }

    async function watch(session) {
        const deadline = now() + watchMs;
        while (true) {
            await read(session);
            if (!session.turn || agentTurnTerminal(session.turn.status)) return;
            if (now() >= deadline) throw new Error('等待结果超时；服务端轮次可能仍在运行。请检查状态或停止，勿重复发送。');
            await sleep(pollMs);
        }
    }

    async function sendChatAgentMessage({ retry = false } = {}) {
        const session = current();
        if (!session?.enabled || view.busy || state.connectionSwitcher?.busy) return;
        if (view.active && view.active !== session || state.engine.generating && view.active !== session) return;
        if (session.pending && !retry) throw new Error('上次发送状态尚未确认，请先检查状态或恢复本次发送。');
        if (session.turn && !agentTurnTerminal(session.turn.status)) throw new Error('当前 Agent 轮次尚未结束，请先检查状态或停止。');
        if (retry && !session.pending || !retry && !session.draft.trim()) return;
        if (!retry) session.turn = null;
        session.stopRequested = false;
        const entity = getSelectedChatEntity();
        const key = getChatContextKey();
        const metadata = state.chatMetadata?.[getChatCacheKey(key, state.selected.chat)] || {};
        const selection = currentAgentSelection(entity, metadata, session.executor);
        view.busy = true;
        view.active = session;
        state.engine.generating = true;
        session.error = '';
        render();
        try {
            if (!session.conversationId) {
                const sync = await waitForEngineSync();
                if (sync?.settled === false) throw new Error('当前设置仍在保存，请稍后重试。');
                const created = await request(`${AGENT_API}/workspace/start`, { body: selection });
                if (!created?.conversationId) throw new Error('Agent 未返回会话标识。');
                session.conversationId = created.conversationId;
                session.notices = created.notices || [];
            }
            if (!session.pending) {
                await read(session);
                if (session.snapshot.conversation.activeTurnId) throw new Error('当前 Agent 会话仍有未结束轮次。');
                session.pending = { schemaVersion: 1, type: 'send', content: session.draft.trim(),
                    clientRequestId: requestId(), expectedContentRevision: session.snapshot.conversation.contentRevision };
            }
            if (session.stopRequested) { session.pending = null; throw new Error('已在发送前停止，草稿已保留。'); }
            const accepted = await request(`${path(session.conversationId)}/turns`, { body: session.pending });
            if (!accepted?.turnId) throw new Error('发送结果不明确，请检查状态或恢复本次发送。');
            session.turn = { id: accepted.turnId, status: accepted.status };
            session.draft = '';
            if (session.stopRequested) await stopChatAgent();
            await watch(session);
        } catch (error) {
            session.error = agentErrorMessage(error);
            // A known rejection did not dispatch; an ambiguous failure keeps the exact
            // request for an explicit, idempotent retry rather than creating a new charge.
            if (!session.turn && error.status >= 400 && error.status < 500 && error.status !== 408) session.pending = null;
            if (!session.pending && (!session.turn || agentTurnTerminal(session.turn.status))) release(session);
        } finally {
            view.busy = false;
            render();
        }
    }

    async function refreshChatAgent() {
        const session = current();
        if (!session?.conversationId || view.busy) return;
        view.busy = true;
        session.error = '';
        try { await read(session); } catch (error) { session.error = agentErrorMessage(error); } finally { view.busy = false; render(); }
    }

    async function stopChatAgent() {
        const session = view.active || current();
        if (session) session.stopRequested = true;
        if (!session?.conversationId) return;
        try {
            // Recover an accepted turn after a lost POST response without submitting again.
            if (!session.turn?.id) await read(session);
            if (!session.turn?.id || agentTurnTerminal(session.turn.status)) return;
            await request(`${AGENT_API}/turns/${encodeURIComponent(session.turn.id)}/stop`, { body: { schemaVersion: 1 } });
            await read(session);
        } catch (error) { session.error = agentErrorMessage(error); }
        render();
    }

    function newChatAgentConversation() {
        const session = current();
        if (!session || view.busy || view.active || state.engine.generating) throw new Error('当前轮次尚未结束，不能创建新会话。');
        Object.assign(session, { conversationId: '', snapshot: null, turn: null, pending: null, error: '', notices: [] });
        render();
    }

    return { setChatAgentMode, setChatAgentDraft, setChatAgentExecutor, sendChatAgentMessage, refreshChatAgent, stopChatAgent, newChatAgentConversation,
        isChatAgentActive: () => Boolean(view.active) };
}

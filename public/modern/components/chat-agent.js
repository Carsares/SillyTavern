import { AGENT_API, agentTurnTerminal, getChatAgentState, getChatAgentSession } from '../core/chat-agent-state.js';

export function createChatAgentComponents({ state, escapeHtml, getChatContextKey, isGroupChatMode }) {
    const button = (action, label, disabled = false) => `<button type="button" class="secondary-button" data-chat-agent-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;

    function renderChatAgentToggle() {
        const session = getChatAgentSession(state, getChatContextKey());
        return `<div class="composer-meta">${button(session?.enabled ? 'ordinary' : 'agent', session?.enabled ? '返回普通聊天' : 'Agent 对话', state.engine.generating || getChatAgentState(state).busy || isGroupChatMode())}
            <span class="row-subtitle">${isGroupChatMode() ? '原群聊暂不直接转为 Agent 会话；可在 <a href="/modern/?view=agent" target="_blank" rel="noopener noreferrer">Agent 工作区</a> 创建群聊。' : 'Agent 使用当前已保存的配置建立独立会话，保留普通聊天和草稿。'}</span></div>`;
    }

    function renderChatAgent() {
        const session = getChatAgentSession(state, getChatContextKey());
        if (!session?.enabled) return '';
        const view = getChatAgentState(state);
        const messages = (session.snapshot?.messages || []).filter(message => !message.deletedAt && !message.userHidden);
        const running = Boolean(view.active === session || session.turn && !agentTurnTerminal(session.turn.status));
        const busy = view.busy || state.engine.generating || state.connectionSwitcher?.busy;
        const media = items => (items || []).filter(item => item.attachmentId).map(item => `<a href="${AGENT_API}/attachments/${encodeURIComponent(item.attachmentId)}" target="_blank" rel="noopener">${escapeHtml(item.name || '下载附件')}</a>`).join(' ');
        return `<section class="agent-chat" aria-label="Agent 对话" data-chat-agent-panel>
            <p class="panel-subtitle">${session.conversationId ? '本会话沿用创建时的资源。修改原配置后，请新建 Agent 会话。' : '首次发送时读取当前已保存的连接、角色、人设、世界书和预设。旧聊天历史不会导入。'}</p>
            <label class="field-label">执行器
                <select data-chat-agent-executor ${busy || session.conversationId ? 'disabled' : ''}>
                    ${[['pi', 'PI'], ['claude', 'Claude'], ['codex', 'Codex']].map(([value, label]) => `<option value="${value}" ${session.executor === value ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
            </label>
            ${session.conversationId ? `<p class="row-subtitle">Agent 会话：${escapeHtml(session.conversationId)} · <a href="/modern/?view=agent&amp;cid=${encodeURIComponent(session.conversationId)}" target="_blank" rel="noopener noreferrer">在完整 Agent 工作区打开此会话</a></p>` : ''}
            <p class="row-subtitle">这是独立的新 Agent 会话，不含原聊天历史。刷新后可在 <a href="/modern/?view=agent" target="_blank" rel="noopener noreferrer">Agent 工作区会话列表</a> 找回；本页草稿仅保存在当前页面。</p>
            ${(session.notices || []).map(notice => `<p class="row-subtitle">${escapeHtml(typeof notice === 'string' ? notice : JSON.stringify(notice))}</p>`).join('')}
            ${session.error ? `<p role="alert" class="danger">${escapeHtml(session.error)}</p>` : ''}
            <div class="message-list-frame"><div class="message-list" aria-live="polite">
                ${messages.map(message => `<article class="message"><strong>${escapeHtml(message.role === 'user' ? '你' : message.role === 'assistant' ? 'Agent' : message.role)}</strong><div class="message-body" style="white-space:pre-wrap">${escapeHtml(typeof message.content === 'string' ? message.content : JSON.stringify(message.content))}</div>${media(message.media)}</article>`).join('')}
                ${session.turn?.status !== 'completed' && session.turn?.content && !messages.some(message => message.role === 'assistant' && message.turnId === session.turn.id && message.content === session.turn.content) ? `<article class="message"><strong>Agent · ${escapeHtml(session.turn.status)}</strong><div class="message-body" style="white-space:pre-wrap">${escapeHtml(session.turn.content)}</div></article>` : ''}
            </div></div>
            <div class="composer">
                <textarea data-chat-agent-input rows="2" ${busy || session.pending ? 'disabled' : ''} placeholder="发送给 Agent（Ctrl/⌘ + Enter）">${escapeHtml(session.draft)}</textarea>
                ${button('send', '发送给 Agent', busy || Boolean(session.pending))}
                ${button('refresh', '检查状态', view.busy || !session.conversationId)}
                ${running ? button('stop', '停止 Agent') : ''}
                ${session.pending && !session.turn ? button('retry', '恢复本次发送', view.busy) : ''}
                ${button('new', '使用当前配置新建会话', busy || Boolean(session.pending) || Boolean(view.active))}
            </div>
        </section>`;
    }
    return { renderChatAgent, renderChatAgentToggle };
}

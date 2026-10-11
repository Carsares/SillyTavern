export const AGENT_WORKSPACE_URL = '/modern/conversation/';

/** Forward only the requested conversation, encoded for a fixed same-origin URL. */
export function agentWorkspaceUrl(search = '') {
    const id = new URLSearchParams(search).get('cid');
    return id === null ? AGENT_WORKSPACE_URL : `${AGENT_WORKSPACE_URL}?${new URLSearchParams({ cid: id })}`;
}

/** The list must come from the authenticated API. An explicit invalid link never
 * falls back to another conversation or creates one. Snapshot access is checked
 * again by the client's choose() before any conversation is displayed.
 */
export function initialAgentConversation(conversations, requestedId, savedId) {
    if (requestedId !== null) {
        if (!requestedId || !conversations.some(item => item.id === requestedId)) {
            throw new Error('请求的 Agent 会话不存在或当前用户无权访问，请从会话列表选择。');
        }
        return requestedId;
    }
    return savedId && conversations.some(item => item.id === savedId) ? savedId : null;
}

import { agentWorkspaceUrl } from '../conversation/core/navigation.js';
export { AGENT_WORKSPACE_URL } from '../conversation/core/navigation.js';

/** Fixed same-origin URL; cookies and CSRF remain owned by the authenticated server. */
export function renderAgentWorkspace(search = globalThis.location?.search || '') {
    const url = agentWorkspaceUrl(search);
    return `
        <header class="agent-workspace-header">
            <div>
                <h1>Agent 会话</h1>
                <p>会话、资源、记忆、检索、工具、群聊、用量与维护均可在下方工作区使用。</p>
            </div>
            <a href="${url}" target="_blank" rel="noopener noreferrer">在新标签页打开 Agent 会话</a>
        </header>
        <p data-agent-load-status role="status">正在加载 Agent 会话…</p>
        <iframe class="agent-workspace-frame" src="${url}" title="Agent 会话工作区" referrerpolicy="same-origin"></iframe>
    `;
}

/** Keep the browsing context connected while other Modern pages render.
 * Moving/removing the iframe would discard drafts and restart its event stream.
 */
export function createAgentWorkspaceHost(content) {
    const host = content.ownerDocument.createElement('main');
    host.id = 'agentWorkspace';
    host.className = 'agent-workspace';
    host.tabIndex = -1;
    host.setAttribute('aria-label', 'Agent 会话');
    host.hidden = true;
    host.style.display = 'none';
    let mounted = false;
    let contentDisplay;
    let contentHidden;
    return {
        show(markup) {
            if (!mounted) {
                host.innerHTML = markup;
                const frame = host.querySelector('iframe');
                const status = host.querySelector('[data-agent-load-status]');
                frame.addEventListener('load', () => {
                    let loaded = false;
                    try { loaded = Boolean(frame.contentDocument?.querySelector('#conversation-app')); } catch { /* Server embedding restrictions stay visible. */ }
                    status.hidden = loaded;
                    if (!loaded) status.textContent = 'Agent 页面未能在工作区加载。请使用上方新标签页入口检查登录或服务状态。';
                });
                frame.addEventListener('error', () => {
                    status.hidden = false;
                    status.textContent = 'Agent 页面加载失败，可使用上方新标签页入口重试。';
                });
                content.insertAdjacentElement('afterend', host);
                mounted = true;
            }
            if (host.hidden) {
                contentDisplay = content.style.display;
                contentHidden = content.hidden;
                content.hidden = true;
                content.style.display = 'none';
                host.hidden = false;
                host.style.display = '';
                host.focus({ preventScroll: true });
            }
        },
        hide() {
            if (host.hidden) return;
            host.hidden = true;
            host.style.display = 'none';
            content.hidden = contentHidden;
            content.style.display = contentDisplay;
            content.focus({ preventScroll: true });
        },
    };
}

import { routeLabels } from '../core/constants.js';
import { createInspectorSections } from './inspector-sections.js';

export function createInspector({
    state,
    elements,
    getPersonas,
    getPresetGroups,
    getChatEntityName,
    getChatModeLabel,
    getProviderInfo,
    getSelectedChatEntity,
    getSelectedChatList,
    isGroupChatMode,
    renderKeyValue,
}) {
    const {
        getSelectedChat,
        renderRouteContextSection,
        renderSection,
    } = createInspectorSections({
        state,
        getPersonas,
        getPresetGroups,
        getChatEntityName,
        getChatModeLabel,
        getSelectedChatList,
        isGroupChatMode,
        renderKeyValue,
    });

    function renderInspector() {
        const provider = getProviderInfo();
        const selectedCharacter = state.characters.find(character => character.avatar === state.selected.character);
        const selectedGroup = state.groups.find(group => group.id === state.selected.group);
        const selectedEntity = getSelectedChatEntity();
        const selectedChat = getSelectedChat(getSelectedChatList());

        elements.inspector.classList.toggle('open', state.inspectorOpen);
        elements.inspector.setAttribute('aria-hidden', state.inspectorOpen ? 'false' : 'true');
        document.querySelectorAll('[data-toggle-inspector]').forEach(button => {
            button.classList.toggle('active', state.inspectorOpen);
            button.setAttribute('aria-pressed', state.inspectorOpen ? 'true' : 'false');
        });

        elements.inspector.innerHTML = `
            <section class="inspector-section inspector-head">
                <div>
                    <h2 class="inspector-title">上下文</h2>
                    <p class="panel-subtitle">当前页面、连接和选中资源。</p>
                </div>
                <button class="icon-button mini" type="button" data-toggle-inspector title="关闭上下文">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </section>
            ${renderSection('会话', [
        ['用户', state.me?.name || state.me?.handle || '默认用户'],
        ['入口', routeLabels[state.route]],
        ['状态', state.errors.length ? '部分失败' : '正常'],
    ])}
            ${renderRouteContextSection(provider, selectedCharacter, selectedGroup, selectedEntity, selectedChat)}
            <section class="inspector-section">
                <h2 class="inspector-title">读取错误</h2>
                ${state.errors.length ? `
                    <div class="kv-list">
                        ${state.errors.map(error => renderKeyValue(error.key, error.message)).join('')}
                    </div>
                ` : '<p class="muted">暂无错误。</p>'}
            </section>
        `;
    }

    function toggleInspector() {
        state.inspectorOpen = !state.inspectorOpen;
        localStorage.setItem('st-modern-inspector-open', String(state.inspectorOpen));
        renderInspector();
    }

    return {
        renderInspector,
        toggleInspector,
    };
}

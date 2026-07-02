import { routeLabels } from '../core/constants.js';
import { formatNumber } from '../core/utils.js';

export function createInspector({
    state,
    elements,
    getChatEntityName,
    getChatModeLabel,
    getProviderInfo,
    getSelectedChatEntity,
    getSelectedChatList,
    isGroupChatMode,
    renderKeyValue,
}) {
    function renderInspector() {
        const provider = getProviderInfo();
        const selectedCharacter = state.characters.find(character => character.avatar === state.selected.character);
        const selectedGroup = state.groups.find(group => group.id === state.selected.group);
        const selectedEntity = getSelectedChatEntity();
        const selectedWorldbook = state.worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook);
        const selectedChat = getSelectedChatList().find(chat => chat.file_id === state.selected.chat);
        const selectedGroupMembers = selectedGroup?.members?.length ?? 0;
        const currentContextDetail = isGroupChatMode()
            ? renderKeyValue('群聊成员', selectedGroup ? `${formatNumber(selectedGroupMembers)} 个` : '未选中')
            : renderKeyValue('角色文件', selectedCharacter?.avatar || '未选中');

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
            <section class="inspector-section">
                <h2 class="inspector-title">会话</h2>
                <div class="kv-list">
                    ${renderKeyValue('用户', state.me?.name || state.me?.handle || '默认用户')}
                    ${renderKeyValue('入口', routeLabels[state.route])}
                    ${renderKeyValue('状态', state.errors.length ? '部分失败' : '正常')}
                </div>
            </section>
            <section class="inspector-section">
                <h2 class="inspector-title">API</h2>
                <div class="kv-list">
                    ${renderKeyValue('主 API', provider.api)}
                    ${renderKeyValue('来源', provider.chatSource || '未配置')}
                    ${renderKeyValue('模型', provider.model || '未配置')}
                </div>
            </section>
            <section class="inspector-section">
                <h2 class="inspector-title">当前上下文</h2>
                <div class="kv-list">
                    ${renderKeyValue('聊天类型', getChatModeLabel())}
                    ${renderKeyValue('当前对象', getChatEntityName(selectedEntity))}
                    ${currentContextDetail}
                    ${renderKeyValue('聊天文件', selectedChat?.file_name || state.selected.chat || '未选中')}
                    ${renderKeyValue('世界书', selectedWorldbook?.name || selectedWorldbook?.file_id || '未选中')}
                </div>
            </section>
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

    return { renderInspector };
}

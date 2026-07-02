import { routeLabels } from '../core/constants.js';
import { formatBytes, formatDate, formatNumber, stripJsonlExtension } from '../core/utils.js';

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
    function renderSection(title, rows) {
        return `
            <section class="inspector-section">
                <h2 class="inspector-title">${title}</h2>
                <div class="kv-list">
                    ${rows.map(([label, value]) => renderKeyValue(label, value)).join('')}
                </div>
            </section>
        `;
    }

    function getSelectedChat(chats) {
        return chats.find(chat => {
            const chatId = stripJsonlExtension(chat.file_id || chat.file_name || '');
            return chatId === state.selected.chat;
        });
    }

    function getSelectedWorldbook() {
        return state.worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook);
    }

    function getWorldEntries(worldbookId) {
        const entries = state.worldDetails?.[worldbookId]?.entries || {};
        return Array.isArray(entries) ? entries : Object.values(entries);
    }

    function getAssetFileCount() {
        return Object.values(state.assets || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
    }

    function getBackgroundCount() {
        return Array.isArray(state.backgrounds?.images) ? state.backgrounds.images.length : 0;
    }

    function getBackgroundFolderCount() {
        return Array.isArray(state.backgroundFolders?.folders) ? state.backgroundFolders.folders.length : 0;
    }

    function renderChatContextSection(selectedCharacter, selectedGroup, selectedEntity, selectedChat) {
        const selectedGroupMembers = selectedGroup?.members?.length ?? 0;
        const currentContextDetail = isGroupChatMode()
            ? ['群聊成员', selectedGroup ? `${formatNumber(selectedGroupMembers)} 个` : '未选中']
            : ['角色文件', selectedCharacter?.avatar || '未选中'];
        const chatMessages = state.chatMessages?.[`${isGroupChatMode() ? `group:${selectedGroup?.id || ''}` : selectedCharacter?.avatar || ''}::${state.selected.chat || ''}`] || [];

        return renderSection('聊天状态', [
            ['聊天类型', getChatModeLabel()],
            ['当前对象', getChatEntityName(selectedEntity)],
            currentContextDetail,
            ['聊天文件', selectedChat?.file_name || (state.selected.chat ? `${state.selected.chat}.jsonl` : '未选中')],
            ['会话数量', `${formatNumber(getSelectedChatList().length)} 个`],
            ['已载入消息', `${formatNumber(chatMessages.length)} 条`],
            ['生成状态', state.engine.status],
            ['备份面板', state.chatBackups.open ? '已打开' : '未打开'],
        ]);
    }

    function renderApiContextSection(provider) {
        return renderSection('连接诊断', [
            ['主 API', provider.api],
            ['来源', provider.chatSource || '未配置'],
            ['模型', provider.model || '未配置'],
            ['预设', provider.preset || '未配置'],
            ['测试状态', state.apiTest.status],
            ['测试详情', state.apiTest.detail],
            ['最近测试', `${formatNumber(state.apiTestHistory.length)} 条`],
            ['密钥显示', state.secrets?.allowKeysExposure ? '允许显示' : '隐藏明文'],
        ]);
    }

    function renderWorldbookContextSection() {
        const selectedWorldbook = getSelectedWorldbook();
        const entries = getWorldEntries(selectedWorldbook?.file_id);
        const enabledCount = entries.filter(entry => !entry.disable).length;
        const selectedCount = state.worldEntryList.worldbookId === selectedWorldbook?.file_id ? state.worldEntryList.selectedKeys.length : 0;

        return renderSection('世界书状态', [
            ['当前世界书', selectedWorldbook?.name || selectedWorldbook?.file_id || '未选中'],
            ['条目数量', `${formatNumber(entries.length)} 条`],
            ['启用条目', `${formatNumber(enabledCount)} 条`],
            ['选中条目', `${formatNumber(selectedCount)} 条`],
            ['列表排序', state.worldEntryList.sort],
            ['当前页', formatNumber(state.worldEntryList.page)],
        ]);
    }

    function renderAssetContextSection() {
        return renderSection('素材状态', [
            ['当前视图', state.assetTab === 'files' ? '资产文件' : '背景'],
            ['背景数量', `${formatNumber(getBackgroundCount())} 个`],
            ['资产文件', `${formatNumber(getAssetFileCount())} 个`],
            ['背景文件夹', `${formatNumber(getBackgroundFolderCount())} 个`],
            ['选择模式', state.backgroundSelection.active ? '已开启' : '未开启'],
            ['选中背景', `${formatNumber(state.backgroundSelection.filenames.length)} 个`],
        ]);
    }

    function renderSettingsContextSection() {
        return renderSection('设置状态', [
            ['当前分区', state.settingsSection],
            ['主题', state.theme],
            ['上下文抽屉', state.inspectorOpen ? '展开' : '收起'],
            ['快照数量', `${formatNumber(state.settingsSnapshots.items.length)} 个`],
            ['快照预览', state.settingsSnapshots.previewName || '未选择'],
            ['请求压缩', state.settings?.request_compression?.enabled ? '已开启' : '未开启'],
        ]);
    }

    function renderCharacterContextSection(selectedCharacter) {
        const detail = state.characterDetails?.[selectedCharacter?.avatar] || selectedCharacter || {};
        const name = detail.name || detail.data?.name || selectedCharacter?.avatar || '未选中';
        const tags = Array.isArray(detail.data?.tags) ? detail.data.tags : [];

        return renderSection('角色状态', [
            ['当前角色', name],
            ['角色文件', detail.avatar || selectedCharacter?.avatar || '未选中'],
            ['作者', detail.data?.creator || '未知'],
            ['标签数量', `${formatNumber(tags.length)} 个`],
            ['聊天占用', formatBytes(detail.chat_size)],
            ['编辑状态', state.characterEditing.avatar ? `编辑 ${state.characterEditing.avatar}` : '未编辑'],
            ['删除确认', state.characterDeleteConfirm.avatar || '无'],
        ]);
    }

    function renderGroupContextSection(selectedGroup) {
        const members = Array.isArray(selectedGroup?.members) ? selectedGroup.members : [];

        return renderSection('群组状态', [
            ['当前群组', selectedGroup?.name || selectedGroup?.id || '未选中'],
            ['群组 ID', selectedGroup?.id || '未选中'],
            ['成员数量', `${formatNumber(members.length)} 个`],
            ['群组数量', `${formatNumber(state.groups.length)} 个`],
            ['编辑状态', state.groupEditing.id ? `编辑 ${state.groupEditing.id}` : '未编辑'],
            ['删除确认', state.groupDeleteConfirm.id || '无'],
        ]);
    }

    function renderPersonaContextSection() {
        const personas = getPersonas();
        const defaultPersona = personas.find(persona => persona.default);

        return renderSection('人设状态', [
            ['人设数量', `${formatNumber(personas.length)} 个`],
            ['默认人设', defaultPersona?.name || '未设置'],
            ['创建面板', state.personaCreating.active ? '已打开' : '未打开'],
            ['编辑状态', state.personaEditing.avatarId || '未编辑'],
            ['删除确认', state.personaDeleteConfirm.avatarId || '无'],
        ]);
    }

    function renderPresetContextSection() {
        const groups = getPresetGroups();
        const selectedGroup = groups.find(group => group.id === state.presetSelection.apiId);
        const total = groups.reduce((sum, group) => sum + group.names.length, 0);

        return renderSection('预设状态', [
            ['预设总数', `${formatNumber(total)} 个`],
            ['分组数量', `${formatNumber(groups.length)} 个`],
            ['当前分组', selectedGroup?.label || state.presetSelection.apiId || '未选中'],
            ['当前预设', state.presetSelection.name || '未选中'],
            ['编辑器', state.presetEditor.name ? `编辑 ${state.presetEditor.name}` : '未编辑'],
            ['删除确认', state.presetDeleteConfirm.name || '无'],
        ]);
    }

    function renderExtensionContextSection() {
        const systemCount = state.extensions.filter(extension => extension.type === 'system').length;
        const manageableCount = state.extensions.filter(extension => extension.type === 'local' || extension.type === 'global').length;

        return renderSection('扩展状态', [
            ['当前筛选', state.extensionView],
            ['发现数量', `${formatNumber(state.extensions.length)} 个`],
            ['系统扩展', `${formatNumber(systemCount)} 个`],
            ['可管理扩展', `${formatNumber(manageableCount)} 个`],
            ['安装面板', state.extensionInstall.active ? '已打开' : '未打开'],
            ['详情面板', state.extensionDetails.name || '未打开'],
            ['待执行操作', state.extensionOperation.action || '无'],
        ]);
    }

    function renderActivityContextSection() {
        const stats = state.stats || {};

        return renderSection('活动状态', [
            ['筛选条件', state.activityFilter || '未筛选'],
            ['排序方式', state.activitySort],
            ['统计字段', `${formatNumber(Object.keys(stats).length)} 个`],
            ['统计时间', stats.timestamp ? formatDate(stats.timestamp) : '未生成'],
        ]);
    }

    function renderGenericContextSection(provider) {
        return renderSection('当前页面', [
            ['入口', routeLabels[state.route]],
            ['角色', `${formatNumber(state.characters.length)} 个`],
            ['群组', `${formatNumber(state.groups.length)} 个`],
            ['世界书', `${formatNumber(state.worldbooks.length || provider.worldCount || 0)} 个`],
            ['扩展', `${formatNumber(state.extensions.length)} 个`],
            ['读取状态', state.errors.length ? '部分失败' : '正常'],
        ]);
    }

    function renderRouteContextSection(provider, selectedCharacter, selectedGroup, selectedEntity, selectedChat) {
        switch (state.route) {
            case 'chat':
                return renderChatContextSection(selectedCharacter, selectedGroup, selectedEntity, selectedChat);
            case 'api':
                return renderApiContextSection(provider);
            case 'worldbooks':
                return renderWorldbookContextSection();
            case 'assets':
                return renderAssetContextSection();
            case 'settings':
                return renderSettingsContextSection();
            case 'characters':
                return renderCharacterContextSection(selectedCharacter);
            case 'groups':
                return renderGroupContextSection(selectedGroup);
            case 'personas':
                return renderPersonaContextSection();
            case 'presets':
                return renderPresetContextSection();
            case 'extensions':
                return renderExtensionContextSection();
            case 'activity':
                return renderActivityContextSection();
            default:
                return renderGenericContextSection(provider);
        }
    }

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

import { routes } from '../core/constants.js';
import { escapeHtml, formatNumber, normalizeText } from '../core/utils.js';

export function createPalette({
    state,
    elements,
    getChatId,
    getChatMessageCount,
    getChatModeLabel,
    getPersonas,
    getPresetGroups,
    getPresetItems,
    getSelectedChatList,
    renderInlineEmpty,
}) {
    function renderPalette() {
        const query = normalizeText(state.paletteQuery);
        const routeCommands = routes.map(route => ({
            type: '页面',
            label: route.label,
            detail: route.id,
            route: route.id,
        }));
        const characterCommands = state.characters.slice(0, 80).map(character => ({
            type: '角色',
            label: character.name || character.data?.name || character.avatar,
            detail: character.avatar,
            route: 'characters',
            select: 'character',
            id: character.avatar,
        }));
        const groupCommands = state.groups.slice(0, 80).map(group => ({
            type: '群组',
            label: group.name || group.id,
            detail: `${formatNumber(Array.isArray(group.members) ? group.members.length : 0)} 个成员`,
            route: 'groups',
            select: 'group',
            id: group.id,
        }));
        const worldCommands = state.worldbooks.slice(0, 80).map(worldbook => ({
            type: '世界书',
            label: worldbook.name || worldbook.file_id,
            detail: worldbook.file_id,
            route: 'worldbooks',
            select: 'worldbook',
            id: worldbook.file_id,
        }));
        const chatCommands = getSelectedChatList().slice(0, 80).map(chat => ({
            type: '聊天文件',
            label: chat.file_name || getChatId(chat),
            detail: `${getChatModeLabel()} · ${formatNumber(getChatMessageCount(chat))} 条消息`,
            route: 'chat',
            select: 'chat',
            id: getChatId(chat),
        }));
        const presetCommands = getPresetGroups().flatMap(group => getPresetItems(group).slice(0, 20).map(item => ({
            type: '预设',
            label: item.name,
            detail: group.label,
            route: 'presets',
        })));
        const personaCommands = getPersonas().slice(0, 80).map(persona => ({
            type: '用户人设',
            label: persona.name || persona.avatarId,
            detail: persona.title || persona.avatarId,
            route: 'personas',
        }));
        const actionCommands = [
            { type: '动作', label: '新建角色', detail: '打开角色创建表单', route: 'characters', action: 'create-character' },
            { type: '动作', label: '新建群组', detail: '打开群组创建表单', route: 'groups', action: 'create-group' },
            { type: '动作', label: '新建世界书', detail: '打开世界书创建表单', route: 'worldbooks', action: 'create-worldbook' },
            { type: '动作', label: 'API 连接检查', detail: '进入 API 管理页', route: 'api' },
            { type: '动作', label: '设置快照', detail: '进入设置中心', route: 'settings' },
        ];
        const commands = [...routeCommands, ...actionCommands, ...characterCommands, ...groupCommands, ...chatCommands, ...worldCommands, ...presetCommands, ...personaCommands]
            .filter(command => !query || normalizeText(`${command.type} ${command.label} ${command.detail}`).includes(query))
            .slice(0, 40);

        elements.paletteResults.innerHTML = commands.map(command => `
            <button class="command-row" type="button" data-command-route="${escapeHtml(command.route)}" data-command-select="${escapeHtml(command.select || '')}" data-command-id="${escapeHtml(command.id || '')}" data-command-action="${escapeHtml(command.action || '')}">
                <span class="avatar-fallback"><i class="fa-solid fa-arrow-right"></i></span>
                <span class="row-main">
                    <span class="row-title">${escapeHtml(command.label)}</span>
                    <span class="row-subtitle">${escapeHtml(command.type)} · ${escapeHtml(command.detail)}</span>
                </span>
            </button>
        `).join('') || renderInlineEmpty('没有匹配结果');
    }

    return { renderPalette };
}

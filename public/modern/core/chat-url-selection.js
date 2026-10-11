// 聊天工作区的选择写进 URL 查询参数（?view=chat&char=<avatar>&chat=<file> 或 &group=<id>&chat=<file>），
// 刷新页面后据此回到原来的角色/群聊与聊天文件。只用 history.replaceState 改写，不新增历史记录；其他参数原样保留。
export const chatSelectionUrlParams = Object.freeze({
    character: 'char',
    group: 'group',
    chat: 'chat',
});

// 动作层也会在没有页面的环境（如 Node 下的 helper 测试）里构造，此时没有 URL 可读写。
function getPageLocation() {
    return globalThis.window?.location?.href ? globalThis.window.location : null;
}

/**
 * Reads the chat selection from the page URL.
 * @param {string} [href] URL to read; defaults to the current page
 * @returns {{ groupMode: boolean, entityId: string, chatId: string } | null} Selection, or null when the URL names no entity
 */
export function readChatSelectionFromUrl(href = getPageLocation()?.href) {
    if (!href) {
        return null;
    }
    const params = new URL(href).searchParams;
    const groupId = params.get(chatSelectionUrlParams.group) || '';
    const avatar = params.get(chatSelectionUrlParams.character) || '';
    const chatId = params.get(chatSelectionUrlParams.chat) || '';
    if (groupId) {
        return { groupMode: true, entityId: groupId, chatId };
    }
    if (avatar) {
        return { groupMode: false, entityId: avatar, chatId };
    }
    return null;
}

/**
 * Mirrors a chat selection into the page URL; an empty entity removes the chat parameters.
 * @param {{ groupMode?: boolean, entityId?: string, chatId?: string }} [selection] Selection to write
 */
export function writeChatSelectionToUrl({ groupMode = false, entityId = '', chatId = '' } = {}) {
    if (!getPageLocation() || !globalThis.window.history?.replaceState) {
        return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(chatSelectionUrlParams.character);
    url.searchParams.delete(chatSelectionUrlParams.group);
    url.searchParams.delete(chatSelectionUrlParams.chat);
    if (entityId) {
        url.searchParams.set(groupMode ? chatSelectionUrlParams.group : chatSelectionUrlParams.character, entityId);
        if (chatId) {
            url.searchParams.set(chatSelectionUrlParams.chat, chatId);
        }
    }
    if (url.href !== window.location.href) {
        window.history.replaceState(window.history.state, '', url);
    }
}

/**
 * Mirrors the chat route's current selection into the URL. Outside the chat route the URL is left alone, so the
 * parameters keep naming the chat the user returns to.
 * @param {object} state Modern UI state
 * @param {object | null} entity Selected character or group
 * @param {boolean} groupMode Whether the selection is a group chat
 */
export function syncChatSelectionToUrl(state, entity, groupMode) {
    if (state.route !== 'chat') {
        return;
    }
    writeChatSelectionToUrl({
        groupMode,
        entityId: (groupMode ? entity?.id : entity?.avatar) || '',
        chatId: entity ? state.selected.chat || '' : '',
    });
}

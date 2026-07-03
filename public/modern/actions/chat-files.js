import {
    downloadFile,
    stripJsonlExtension,
    uniqueValues,
} from '../core/utils.js';
import { createChatBackupActions } from './chat-backups.js';
import { createChatFileManagementActions } from './chat-file-management.js';

export function createChatFileActions({
    state,
    apiFetch,
    apiFetchResponse,
    render,
    showToast,
    formatDate,
    formatNumber,
    getSelectedChatEntity,
    getChatContextKey,
    getChatEntityName,
    isGroupChatMode,
    getSelectedChatList,
    getChatId,
    getChatCacheKey,
    getUserName,
    sortChats,
    clearChatSearch,
    loadChatMessages,
    refreshSelectedChatList,
    createModernChatFile,
    saveGroupMetadata,
}) {
    const chatFileManagementActions = createChatFileManagementActions({
        state,
        apiFetch,
        render,
        showToast,
        getSelectedChatEntity,
        getChatContextKey,
        isGroupChatMode,
        getSelectedChatList,
        getChatCacheKey,
        saveGroupMetadata,
        refreshSelectedChatList,
        loadChatMessages,
    });

    async function startNewModernChat() {
        const entity = getSelectedChatEntity();
        const chatId = await createModernChatFile(entity);
        showToast('新聊天已创建', `${getChatEntityName(entity)} 的新会话已选中。`);
        render();
        return chatId;
    }

    async function importModernChatFiles(files) {
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        if (!contextKey) {
            throw new Error(isGroupChatMode() ? '请先选择一个群聊。' : '请先选择一个角色。');
        }

        const importedFileNames = [];
        for (const file of Array.from(files || [])) {
            const format = file.name.split('.').pop()?.toLowerCase() || '';
            if (!['json', 'jsonl'].includes(format)) {
                throw new Error('聊天导入仅支持 JSON 或 JSONL 文件。');
            }
            if (isGroupChatMode() && format !== 'jsonl') {
                throw new Error('群聊导入仅支持 SillyTavern JSONL 文件。');
            }

            const formData = new FormData();
            formData.set('file_type', format);
            formData.set('avatar', file, file.name);
            formData.set('avatar_url', isGroupChatMode() ? '' : entity.avatar);
            formData.set('user_name', getUserName());
            formData.set('character_name', getChatEntityName(entity));
            const result = await apiFetch(isGroupChatMode() ? '/api/chats/group/import' : '/api/chats/import', { body: formData, omitContentType: true });
            if (result?.error) {
                throw new Error(`${file.name} 导入失败，文件格式可能不兼容。`);
            }
            if (isGroupChatMode()) {
                importedFileNames.push(result.res);
            } else {
                importedFileNames.push(...(result?.fileNames || []));
            }
        }

        if (!importedFileNames.length) {
            throw new Error('没有导入任何聊天文件。');
        }

        if (isGroupChatMode()) {
            entity.chats = uniqueValues([...(entity.chats || []), ...importedFileNames.map(stripJsonlExtension)]);
            entity.chat_id = stripJsonlExtension(importedFileNames[0]);
            await saveGroupMetadata(entity);
        }
        clearChatSearch();
        await refreshSelectedChatList(entity);
        state.selected.chat = getChatId({ file_name: importedFileNames[0] });
        await loadChatMessages(entity, state.selected.chat, { force: true });
        showToast('聊天已导入', `${formatNumber(importedFileNames.length)} 个文件`);
        render();
    }

    async function exportModernChat(format) {
        const entity = getSelectedChatEntity();
        const chatId = stripJsonlExtension(state.selected.chat);
        if (!getChatContextKey(entity) || !chatId) {
            throw new Error('请先选择一个聊天文件。');
        }

        const safeFormat = format === 'jsonl' ? 'jsonl' : 'txt';
        const result = await apiFetch('/api/chats/export', {
            body: {
                is_group: isGroupChatMode(),
                avatar_url: isGroupChatMode() ? null : entity.avatar,
                file: `${chatId}.jsonl`,
                exportfilename: `${chatId}.${safeFormat}`,
                format: safeFormat,
            },
        });
        if (!result?.result) {
            throw new Error('聊天导出结果为空。');
        }

        downloadFile(result.result, `${chatId}.${safeFormat}`, safeFormat === 'txt' ? 'text/plain' : 'application/jsonl');
        showToast('导出已开始', `${chatId}.${safeFormat}`);
    }

    const {
        beginChatBackupDelete,
        cancelChatBackupDelete,
        closeChatBackups,
        confirmChatBackupDelete,
        loadChatBackups,
        restoreChatBackup,
        toggleChatBackups,
        viewChatBackup,
    } = createChatBackupActions({
        state,
        apiFetch,
        apiFetchResponse,
        render,
        showToast,
        formatDate,
        getChatContextKey,
        getChatEntityName,
        getSelectedChatEntity,
        importModernChatFiles,
        isGroupChatMode,
        sortChats,
    });

    return {
        startNewModernChat,
        ...chatFileManagementActions,
        importModernChatFiles,
        exportModernChat,
        loadChatBackups,
        toggleChatBackups,
        closeChatBackups,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
    };
}

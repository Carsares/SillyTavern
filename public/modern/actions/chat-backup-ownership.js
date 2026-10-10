import { stripJsonlExtension } from '../core/utils.js';

// Mirrors how src/endpoints/chats.js names automatic chat backups, so the drawer can tell which
// character or group a backup belongs to without a backend change:
//   backupChat(): `chat_${sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${YYYYMMDD-HHMMSS}.jsonl`
// Character saves (/api/chats/save) pass name = avatar_url with the first '.png' removed;
// group saves (/api/chats/group/save) pass the group chat id.
const backupFilePattern = /^chat_(.*)_(\d{8}-\d{6})\.jsonl$/;

const illegalFileNameCharacters = /[/?<>\\:*|"]/g;
const reservedFileName = /^\.+$/;
const windowsReservedFileName = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const windowsTrailingCharacters = /[. ]+$/;
const maxFileNameBytes = 255;

function isControlCharacter(char) {
    const code = char.charCodeAt(0);
    return code <= 0x1f || (code >= 0x80 && code <= 0x9f);
}

function truncateUtf8Bytes(value, maxBytes) {
    const encoder = new TextEncoder();
    let bytes = 0;
    let result = '';
    for (const segment of value) {
        bytes += encoder.encode(segment).length;
        if (bytes > maxBytes) {
            break;
        }
        result += segment;
    }
    return result;
}

// Same steps as sanitize-filename@1.6.3 with its default '' replacement.
function sanitizeFileName(value) {
    const withoutControl = Array.from(value.replace(illegalFileNameCharacters, ''))
        .filter(char => !isControlCharacter(char))
        .join('');
    const sanitized = withoutControl
        .replace(reservedFileName, '')
        .replace(windowsReservedFileName, '')
        .replace(windowsTrailingCharacters, '');
    return truncateUtf8Bytes(sanitized, maxFileNameBytes);
}

export function getChatBackupKey(name) {
    return sanitizeFileName(String(name ?? '')).replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export function getCharacterChatBackupKey(avatar) {
    // chats.js uses String(avatar_url).replace('.png', ''): only the first, case-sensitive occurrence.
    return getChatBackupKey(String(avatar ?? '').replace('.png', ''));
}

function getChatFileId(chat) {
    if (chat === undefined || chat === null) {
        return '';
    }
    if (typeof chat === 'object') {
        return stripJsonlExtension(chat.file_id || chat.file_name || '');
    }
    return stripJsonlExtension(String(chat));
}

export function getGroupChatBackupKeys(group, chats = []) {
    const chatIds = [
        ...(Array.isArray(group?.chats) ? group.chats : []),
        group?.chat_id,
        ...(Array.isArray(chats) ? chats : []),
    ]
        .map(chat => getChatFileId(chat))
        .filter(Boolean);
    return new Set(chatIds.map(chatId => getChatBackupKey(chatId)));
}

/**
 * Backup keys that belong to the selected character or group.
 * @param {{ entity: any, groupMode: boolean, chats?: any[] }} options
 * @returns {Set<string>}
 */
export function getEntityChatBackupKeys({ entity, groupMode, chats = [] }) {
    if (!entity) {
        return new Set();
    }
    if (groupMode) {
        return getGroupChatBackupKeys(entity, chats);
    }
    return entity.avatar ? new Set([getCharacterChatBackupKey(entity.avatar)]) : new Set();
}

/**
 * Owner key encoded in an automatic backup file name, or null for names that do not follow the
 * `chat_<key>_<YYYYMMDD-HHMMSS>.jsonl` pattern.
 * @param {string} fileName
 * @returns {string | null}
 */
export function getChatBackupOwnerKey(fileName) {
    const match = backupFilePattern.exec(String(fileName || ''));
    return match ? match[1] : null;
}

/**
 * Index of backup owner keys to the characters and groups that produce them. The first match wins
 * when two names sanitize to the same key (the backend cannot tell them apart either).
 * @param {{ characters?: any[], groups?: any[] }} options
 * @returns {Map<string, { type: 'character' | 'group', name: string }>}
 */
export function createChatBackupOwnerIndex({ characters = [], groups = [] }) {
    const index = new Map();
    for (const character of Array.isArray(characters) ? characters : []) {
        if (!character?.avatar) {
            continue;
        }
        const key = getCharacterChatBackupKey(character.avatar);
        if (!index.has(key)) {
            index.set(key, { type: 'character', name: character.name || character.data?.name || character.avatar });
        }
    }
    for (const group of Array.isArray(groups) ? groups : []) {
        for (const key of getGroupChatBackupKeys(group)) {
            if (!index.has(key)) {
                index.set(key, { type: 'group', name: group.name || group.id || key });
            }
        }
    }
    return index;
}

/**
 * Human-readable owner of a backup, used in the drawer and in the cross-owner restore confirmation.
 * @param {string} fileName
 * @param {Map<string, { type: 'character' | 'group', name: string }>} ownerIndex
 * @returns {string}
 */
export function describeChatBackupOwner(fileName, ownerIndex) {
    const key = getChatBackupOwnerKey(fileName);
    if (key === null) {
        return '无法识别归属（文件名不符合自动备份格式）';
    }
    const owner = ownerIndex.get(key);
    if (!owner) {
        return `其他角色或群聊（文件名标识「${key}」）`;
    }
    return `${owner.type === 'group' ? '群聊' : '角色'}「${owner.name}」`;
}

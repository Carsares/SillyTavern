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
 * @typedef {{ type: 'character' | 'group', id: string, name: string }} ChatBackupOwner
 */

/**
 * @param {any} character
 * @returns {ChatBackupOwner}
 */
function getCharacterOwner(character) {
    return {
        type: 'character',
        id: String(character.avatar),
        name: character.name || character.data?.name || character.avatar,
    };
}

/**
 * @param {any} group
 * @returns {ChatBackupOwner}
 */
function getGroupOwner(group) {
    return {
        type: 'group',
        id: String(group.id ?? ''),
        name: group.name || group.id || '',
    };
}

/**
 * @param {ChatBackupOwner | null | undefined} left
 * @param {ChatBackupOwner | null | undefined} right
 */
function isSameOwner(left, right) {
    return !!left && !!right && left.type === right.type && left.id === right.id;
}

/**
 * The selected character or group as a backup owner.
 * @param {any} entity
 * @param {boolean} groupMode
 * @returns {ChatBackupOwner | null}
 */
export function getChatBackupEntityOwner(entity, groupMode) {
    if (!entity) {
        return null;
    }
    if (groupMode) {
        return getGroupOwner(entity);
    }
    return entity.avatar ? getCharacterOwner(entity) : null;
}

/**
 * Index of backup owner keys to every character and group that produces them. Names that differ
 * only in characters the backend replaces with '_' (e.g. two Chinese names of the same length)
 * share a key, so one key can list several owners; the backend cannot tell them apart either.
 * @param {{ characters?: any[], groups?: any[] }} options
 * @returns {Map<string, ChatBackupOwner[]>}
 */
export function createChatBackupOwnerIndex({ characters = [], groups = [] }) {
    /** @type {Map<string, ChatBackupOwner[]>} */
    const index = new Map();
    const add = (key, owner) => {
        const owners = index.get(key) || [];
        if (!owners.some(item => isSameOwner(item, owner))) {
            owners.push(owner);
        }
        index.set(key, owners);
    };
    for (const character of Array.isArray(characters) ? characters : []) {
        if (character?.avatar) {
            add(getCharacterChatBackupKey(character.avatar), getCharacterOwner(character));
        }
    }
    for (const group of Array.isArray(groups) ? groups : []) {
        if (!group) {
            continue;
        }
        for (const key of getGroupChatBackupKeys(group)) {
            add(key, getGroupOwner(group));
        }
    }
    return index;
}

function formatOwner(owner) {
    return `${owner.type === 'group' ? '群聊' : '角色'}「${owner.name}」`;
}

/**
 * 「角色「A」、角色「B」」 style list, shortened to `limit` names plus a total.
 * @param {ChatBackupOwner[]} owners
 * @param {number} [limit]
 * @returns {string}
 */
export function formatChatBackupOwners(owners, limit = 4) {
    const shown = owners.slice(0, limit).map(formatOwner).join('、');
    return owners.length > limit ? `${shown} 等 ${owners.length} 个` : shown;
}

/**
 * Human-readable owner of a backup, used in the drawer and in the cross-owner restore confirmation.
 * @param {string} fileName
 * @param {Map<string, ChatBackupOwner[]>} ownerIndex
 * @returns {string}
 */
export function describeChatBackupOwner(fileName, ownerIndex) {
    const key = getChatBackupOwnerKey(fileName);
    if (key === null) {
        return '无法识别归属（文件名不符合自动备份格式）';
    }
    const owners = ownerIndex.get(key) || [];
    if (!owners.length) {
        return `其他角色或群聊（文件名标识「${key}」）`;
    }
    if (owners.length === 1) {
        return formatOwner(owners[0]);
    }
    return `${formatChatBackupOwners(owners)}之一（文件名无法区分）`;
}

/**
 * Resolves backups from the selected character's or group's point of view.
 * `isAmbiguous`: the backup carries the selected entity's key, but another character or group
 * produces the same key, so it may belong to any of `candidates` (selected entity first).
 * @param {{ entity: any, groupMode: boolean, chats?: any[], characters?: any[], groups?: any[] }} options
 */
export function createChatBackupOwnership({ entity, groupMode, chats = [], characters = [], groups = [] }) {
    const currentKeys = getEntityChatBackupKeys({ entity, groupMode, chats });
    const currentOwner = getChatBackupEntityOwner(entity, groupMode);
    const ownerIndex = createChatBackupOwnerIndex({ characters, groups });

    /**
     * @param {string} fileName
     * @returns {{ ownerKey: string | null, isCurrent: boolean, isAmbiguous: boolean, candidates: ChatBackupOwner[] }}
     */
    function resolve(fileName) {
        const ownerKey = getChatBackupOwnerKey(fileName);
        const isCurrent = ownerKey !== null && currentKeys.has(ownerKey);
        if (!isCurrent) {
            return { ownerKey, isCurrent, isAmbiguous: false, candidates: [] };
        }
        const others = (ownerIndex.get(ownerKey) || []).filter(owner => !isSameOwner(owner, currentOwner));
        if (!others.length) {
            return { ownerKey, isCurrent, isAmbiguous: false, candidates: [] };
        }
        return { ownerKey, isCurrent, isAmbiguous: true, candidates: currentOwner ? [currentOwner, ...others] : others };
    }

    return {
        currentOwner,
        ownerIndex,
        resolve,
    };
}

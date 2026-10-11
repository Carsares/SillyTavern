import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import _ from 'lodash';

import validateAvatarUrlMiddleware from '../middleware/validateFileName.js';
import {
    getConfigValue,
    humanizedDateTime,
    tryParse,
    generateTimestamp,
    removeOldBackups,
    formatBytes,
    tryWriteFileSync,
    tryReadFileSync,
    tryDeleteFile,
    readFirstLine,
    isPathUnderParent,
    uuidv4,
} from '../util.js';
import { KeyedPromiseQueue } from '../keyed-promise-queue.js';

const isBackupEnabled = !!getConfigValue('backups.chat.enabled', true, 'boolean');
const maxTotalChatBackups = Number(getConfigValue('backups.chat.maxTotalBackups', -1, 'number'));
const throttleInterval = Number(getConfigValue('backups.chat.throttleInterval', 10_000, 'number'));
const checkIntegrity = !!getConfigValue('backups.chat.checkIntegrity', true, 'boolean');
const CHAT_WRITE_QUEUE = new KeyedPromiseQueue();

export const CHAT_BACKUPS_PREFIX = 'chat_';

/**
 * Saves a chat to the backups directory.
 * @param {string} directory The user's backup directory.
 * @param {string} name The name of the chat.
 * @param {string} data The serialized chat to save.
 * @param {string} backupPrefix The file prefix. Typically CHAT_BACKUPS_PREFIX.
 * @returns
 */
function backupChat(directory, name, data, backupPrefix = CHAT_BACKUPS_PREFIX) {
    try {
        if (!isBackupEnabled) { return; }
        if (!fs.existsSync(directory)) {
            console.error(`The chat couldn't be backed up because no directory exists at ${directory}!`);
        }
        // replace non-alphanumeric characters with underscores
        name = sanitize(name).replace(/[^a-z0-9]/gi, '_').toLowerCase();

        const backupFile = path.join(directory, `${backupPrefix}${name}_${generateTimestamp()}.jsonl`);

        tryWriteFileSync(backupFile, data);
        removeOldBackups(directory, `${backupPrefix}${name}_`);
        if (isNaN(maxTotalChatBackups) || maxTotalChatBackups < 0) {
            return;
        }
        removeOldBackups(directory, backupPrefix, maxTotalChatBackups);
    } catch (err) {
        console.error(`Could not backup chat for ${name}`, err);
    }
}

/**
 * @type {Map<string, import('lodash').DebouncedFunc<typeof backupChat>>}
 */
const backupFunctions = new Map();

/**
 * Gets a backup function for a user.
 * @param {string} handle User handle
 * @returns {typeof backupChat} Backup function
 */
function getBackupFunction(handle) {
    if (!backupFunctions.has(handle)) {
        backupFunctions.set(handle, _.throttle(backupChat, throttleInterval, { leading: true, trailing: true }));
    }
    return backupFunctions.get(handle) || (() => { });
}

/**
 * Gets a preview message from a chat message string.
 * @param {string} [lastMessage] - The message to truncate
 * @returns {string} A truncated preview of the last message or empty string if no messages
 */
function getPreviewMessage(lastMessage) {
    const strlen = 400;

    if (!lastMessage) {
        return '';
    }

    return lastMessage.length > strlen
        ? '...' + lastMessage.substring(lastMessage.length - strlen)
        : lastMessage;
}

process.on('exit', () => {
    for (const func of backupFunctions.values()) {
        func.flush();
    }
});

/**
 * Imports a chat from Ooba's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string} Chat data
 */
function importOobaChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    }];

    for (const arr of jsonData.data_visible) {
        if (arr[0]) {
            const userMessage = {
                name: userName,
                is_user: true,
                send_date: new Date().toISOString(),
                mes: arr[0],
                extra: {},
            };
            chat.push(userMessage);
        }
        if (arr[1]) {
            const charMessage = {
                name: characterName,
                is_user: false,
                send_date: new Date().toISOString(),
                mes: arr[1],
                extra: {},
            };
            chat.push(charMessage);
        }
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from Agnai's format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Chat data
 * @returns {string} Chat data
 */
function importAgnaiChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    }];

    for (const message of jsonData.messages) {
        const isUser = !!message.userId;
        chat.push({
            name: isUser ? userName : characterName,
            is_user: isUser,
            send_date: new Date().toISOString(),
            mes: message.msg,
            extra: {},
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Imports a chat from CAI Tools format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData JSON data
 * @returns {string[]} Converted data
 */
function importCAIChat(userName, characterName, jsonData) {
    /**
     * Converts the chat data to suitable format.
     * @param {object} history Imported chat data
     * @returns {object[]} Converted chat data
     */
    function convert(history) {
        const starter = {
            chat_metadata: {},
            user_name: 'unused',
            character_name: 'unused',
        };

        const historyData = history.msgs.map((msg) => ({
            name: msg.src.is_human ? userName : characterName,
            is_user: msg.src.is_human,
            send_date: new Date().toISOString(),
            mes: msg.text,
            extra: {},
        }));

        return [starter, ...historyData];
    }

    return (jsonData.histories.histories ?? []).map(history => convert(history).map(obj => JSON.stringify(obj)).join('\n'));
}

/**
 * Imports a chat from Kobold Lite format.
 * @param {string} _userName User name
 * @param {string} _characterName Character name
 * @param {object} data JSON data
 * @returns {string} Chat data
 */
function importKoboldLiteChat(_userName, _characterName, data) {
    const inputToken = '{{[INPUT]}}';
    const outputToken = '{{[OUTPUT]}}';

    /** @type {function(string): object} */
    function processKoboldMessage(msg) {
        const isUser = msg.includes(inputToken);
        return {
            name: isUser ? userName : characterName,
            is_user: isUser,
            mes: msg.replaceAll(inputToken, '').replaceAll(outputToken, '').trim(),
            send_date: new Date().toISOString(),
            extra: {},
        };
    }

    // Create the header
    const userName = String(data.savedsettings.chatname);
    const characterName = String(data.savedsettings.chatopponent).split('||$||')[0];
    const header = {
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    };
    // Format messages
    const formattedMessages = data.actions.map(processKoboldMessage);
    // Add prompt if available
    if (data.prompt) {
        formattedMessages.unshift(processKoboldMessage(data.prompt));
    }
    // Combine header and messages
    const chatData = [header, ...formattedMessages];
    return chatData.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Flattens `msg` and `swipes` data from Chub Chat format.
 * Only changes enough to make it compatible with the standard chat serialization format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {string[]} lines serialised JSONL data
 * @returns {string} Converted data
 */
function flattenChubChat(userName, characterName, lines) {
    function flattenSwipe(swipe) {
        return swipe.message ? swipe.message : swipe;
    }

    function convert(line) {
        const lineData = tryParse(line);
        if (!lineData) return line;

        if (lineData.mes && lineData.mes.message) {
            lineData.mes = lineData?.mes.message;
        }

        if (lineData?.swipes && Array.isArray(lineData.swipes)) {
            lineData.swipes = lineData.swipes.map(swipe => flattenSwipe(swipe));
        }

        return JSON.stringify(lineData);
    }

    return (lines ?? []).map(convert).join('\n');
}

/**
 * Imports a chat from RisuAI format.
 * @param {string} userName User name
 * @param {string} characterName Character name
 * @param {object} jsonData Imported chat data
 * @returns {string} Chat data
 */
function importRisuChat(userName, characterName, jsonData) {
    /** @type {object[]} */
    const chat = [{
        chat_metadata: {},
        user_name: 'unused',
        character_name: 'unused',
    }];

    for (const message of jsonData.data.message) {
        const isUser = message.role === 'user';
        chat.push({
            name: message.name ?? (isUser ? userName : characterName),
            is_user: isUser,
            send_date: new Date(Number(message.time ?? Date.now())).toISOString(),
            mes: message.data ?? '',
            extra: {},
        });
    }

    return chat.map(obj => JSON.stringify(obj)).join('\n');
}

/**
 * Checks if the chat being saved has the same integrity as the one being loaded.
 * @param {string} filePath Path to the chat file
 * @param {string|undefined} integritySlug Integrity slug
 * @returns {Promise<boolean>} Whether the chat is intact
 */
async function checkChatIntegrity(filePath, integritySlug) {
    // If the chat file doesn't exist, assume it's intact
    if (!fs.existsSync(filePath)) {
        return true;
    }

    // Parse the first line of the chat file as JSON
    const firstLine = await readFirstLine(filePath);
    const jsonData = tryParse(firstLine);
    const chatIntegrity = jsonData?.chat_metadata?.integrity;

    // If the chat has no integrity metadata, assume it's intact
    if (!chatIntegrity) {
        console.debug(`File "${filePath}" does not have integrity metadata matching "${integritySlug}". The integrity validation has been skipped.`);
        return true;
    }

    // Check if the integrity matches
    return chatIntegrity === integritySlug;
}

/**
 * @typedef {Object} ChatInfo
 * @property {string} [file_id] - The name of the chat file (without extension)
 * @property {string} [file_name] - The name of the chat file (with extension)
 * @property {string} [file_size] - The size of the chat file in a human-readable format
 * @property {number} [chat_items] - The number of chat items in the file
 * @property {string} [mes] - The last message in the chat
 * @property {number|string} [last_mes] - The timestamp of the last message
 * @property {object} [chat_metadata] - Additional chat metadata
 * @property {boolean} [match] - Whether the chat matches the search criteria
 */

/**
 * Reads the information from a chat file.
 * @param {string} pathToFile - Path to the chat file
 * @param {object} additionalData - Additional data to include in the result
 * @param {boolean} withMetadata - Whether to read chat metadata
 * @param {ChatMatchFunction|null} matcher - Optional function to match messages
 * @returns {Promise<ChatInfo>}
 *
 * @typedef {(textArray: string[]) => boolean} ChatMatchFunction
 */
export async function getChatInfo(pathToFile, additionalData = {}, withMetadata = false, matcher = null) {
    const parsedPath = path.parse(pathToFile);
    const stats = await fs.promises.stat(pathToFile);
    const hasMatcher = (typeof matcher === 'function');

    const chatData = {
        match: false,
        file_id: parsedPath.name,
        file_name: parsedPath.base,
        file_size: formatBytes(stats.size),
        chat_items: 0,
        mes: '[The chat is empty]',
        last_mes: stats.mtimeMs,
        ...additionalData,
    };

    if (stats.size === 0) {
        return chatData;
    }

    return new Promise((resolve, reject) => {
        const fileStream = fs.createReadStream(pathToFile);
        fileStream.once('error', reject);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        let lastLine;
        let itemCounter = 0;
        let hasAnyMatch = false;
        let matchBuffer = [];
        rl.on('line', (line) => {
            if (withMetadata && itemCounter === 0) {
                const jsonData = tryParse(line);
                if (jsonData && _.isObjectLike(jsonData.chat_metadata)) {
                    chatData.chat_metadata = jsonData.chat_metadata;
                }
            }
            // Skip matching if any match was already found
            if (hasMatcher && !hasAnyMatch && itemCounter > 0) {
                const jsonData = tryParse(line);
                if (jsonData) {
                    matchBuffer.push(jsonData.mes || '');
                    if (matcher(matchBuffer)) {
                        hasAnyMatch = true;
                        matchBuffer = [];
                    }
                }
            }
            itemCounter++;
            lastLine = line;
        });
        rl.on('close', () => {
            rl.close();

            if (lastLine) {
                const jsonData = tryParse(lastLine);
                if (jsonData && (jsonData.name || jsonData.character_name || jsonData.chat_metadata)) {
                    chatData.chat_items = (itemCounter - 1);
                    chatData.mes = jsonData.mes || '[The message is empty]';
                    chatData.last_mes = jsonData.send_date || new Date(Math.round(stats.mtimeMs)).toISOString();
                    chatData.match = hasMatcher ? hasAnyMatch : true;

                    resolve(chatData);
                } else {
                    console.warn('Found an invalid or corrupted chat file:', pathToFile);
                    resolve({});
                }
            } else {
                console.warn('Found an invalid or corrupted chat file:', pathToFile);
                resolve({});
            }
        });
    });
}

/**
 * Resolves a group chat ID to a file path contained by the current user's group chat directory.
 * @param {string} groupChatsDir Group chat directory
 * @param {unknown} chatId Group chat ID
 * @returns {string|null} Safe group chat file path
 */
function getGroupChatFilePath(groupChatsDir, chatId) {
    if (typeof chatId !== 'string' || !chatId) {
        return null;
    }

    const parentPath = path.resolve(groupChatsDir);
    const filePath = path.resolve(parentPath, `${chatId}.jsonl`);
    return isPathUnderParent(parentPath, filePath) ? filePath : null;
}

/**
 * @typedef {object} ChatFile
 * @property {string} [pngFile] Character card file name (character chats only)
 * @property {string} [groupId] Group ID (group chats only)
 * @property {string} [groupName] Group display name (group chats only)
 * @property {string} filePath Absolute path of the chat file (server side only, never sent to clients)
 * @property {number} mtime Last modification time in milliseconds
 * @property {number} size File size in bytes
 */

/**
 * Lists the chat files of a user: character chats (only for characters whose card still exists), group chats
 * (resolved through the safe group chat path helper) and, optionally, chats lying directly in the chats root.
 * A failing source (missing directory, unreadable group file, vanished file) is skipped without hiding the others.
 * @param {Pick<import('../users.js').UserDirectoryList, 'characters' | 'chats' | 'groups' | 'groupChats'>} directories User directories
 * @param {{ characters?: boolean, groups?: boolean, root?: boolean }} [options] Sources to list
 * @returns {Promise<ChatFile[]>} Chat files in no particular order
 */
export async function listUserChatFiles(directories, { characters = true, groups = true, root = false } = {}) {
    /** @type {ChatFile[]} */
    const allChatFiles = [];

    const getCharacterChatFiles = async () => {
        const pngDirents = await fs.promises.readdir(directories.characters, { withFileTypes: true });
        const pngFiles = pngDirents.filter(e => e.isFile() && path.extname(e.name) === '.png').map(e => e.name);

        for (const pngFile of pngFiles) {
            try {
                const chatsDirectory = pngFile.replace('.png', '');
                const pathToChats = path.join(directories.chats, chatsDirectory);
                const pathStats = await fs.promises.stat(pathToChats).catch(() => null);
                if (!pathStats?.isDirectory()) {
                    continue;
                }
                const chatFiles = await fs.promises.readdir(pathToChats);
                const jsonlFiles = chatFiles.filter(file => path.extname(file) === '.jsonl');

                for (const file of jsonlFiles) {
                    const filePath = path.join(pathToChats, file);
                    const stats = await fs.promises.stat(filePath).catch(() => null);
                    if (stats) {
                        allChatFiles.push({ pngFile, filePath, mtime: stats.mtimeMs, size: stats.size });
                    }
                }
            } catch {
                // Skip a character whose chat directory can't be read
                continue;
            }
        }
    };

    const getGroupChatFiles = async () => {
        const groupDirents = await fs.promises.readdir(directories.groups, { withFileTypes: true });
        const groupFiles = groupDirents.filter(e => e.isFile() && path.extname(e.name) === '.json').map(e => e.name);

        for (const group of groupFiles) {
            try {
                const groupPath = path.join(directories.groups, group);
                const groupContents = await fs.promises.readFile(groupPath, 'utf8');
                const groupData = JSON.parse(groupContents);

                if (Array.isArray(groupData.chats)) {
                    for (const chat of groupData.chats) {
                        const filePath = getGroupChatFilePath(directories.groupChats, chat);
                        if (!filePath) {
                            continue;
                        }
                        const stats = await fs.promises.stat(filePath).catch(() => null);
                        if (stats?.isFile()) {
                            const groupName = typeof groupData.name === 'string' && groupData.name ? groupData.name : String(groupData.id ?? '');
                            allChatFiles.push({ groupId: groupData.id, groupName, filePath, mtime: stats.mtimeMs, size: stats.size });
                        }
                    }
                }
            } catch (error) {
                // Skip group files that can't be read or parsed
                continue;
            }
        }
    };

    const getRootChatFiles = async () => {
        const dirents = await fs.promises.readdir(directories.chats, { withFileTypes: true });
        const chatFiles = dirents.filter(e => e.isFile() && path.extname(e.name) === '.jsonl').map(e => e.name);

        for (const file of chatFiles) {
            const filePath = path.join(directories.chats, file);
            const stats = await fs.promises.stat(filePath).catch(() => null);
            if (stats) {
                allChatFiles.push({ filePath, mtime: stats.mtimeMs, size: stats.size });
            }
        }
    };

    await Promise.allSettled([
        characters ? getCharacterChatFiles() : null,
        groups ? getGroupChatFiles() : null,
        root ? getRootChatFiles() : null,
    ]);

    return allChatFiles;
}

/** Limits of `POST /api/chats/search-all`. */
const CHAT_SEARCH_ALL = Object.freeze({
    defaultLimit: 50,
    maxLimit: 200,
    defaultSnippetsPerChat: 3,
    maxSnippetsPerChat: 10,
    defaultTimeoutMs: 8000,
    maxTimeoutMs: 15000,
    concurrency: 6,
    snippetRadius: 80,
    maxHighlightsPerSnippet: 20,
    maxQueryLength: 200,
    maxTerms: 10,
    maxNameLength: 80,
    // How many lines are read between two checks of the deadline / client connection
    stopCheckInterval: 128,
});

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Characters JSON.stringify writes as escape sequences: a search term containing one cannot be found in the raw line
const JSON_ESCAPED_CHARACTER_PATTERN = /["\\\u0000-\u001f\ud800-\udfff]/;

/**
 * Lowercases text without changing its length, so offsets found in the result are valid in the original text.
 * Characters whose lowercase form has another length (such as U+0130) stay as they are.
 * @param {string} text Text to fold
 * @returns {string} Lowercase text of the same length
 */
function foldCase(text) {
    const lower = text.toLowerCase();
    if (lower.length === text.length) {
        return lower;
    }

    let result = '';
    for (const character of text) {
        const lowerCharacter = character.toLowerCase();
        result += lowerCharacter.length === character.length ? lowerCharacter : character;
    }
    return result;
}

/**
 * Reads an integer option, falling back to a default for missing or non-numeric values and clamping to a range.
 * @param {unknown} value Raw value
 * @param {number} fallback Value for missing or invalid input
 * @param {number} min Smallest allowed value
 * @param {number} max Largest allowed value
 * @returns {number} Integer between min and max
 */
function readIntegerOption(value, fallback, min, max) {
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '') {
        return fallback;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(number)));
}

/**
 * @typedef {object} ChatSearchAllOptions
 * @property {string[]} terms Lowercase search terms; a chat must contain all of them
 * @property {'all'|'characters'|'groups'} scope Which chats to search
 * @property {number} limit Maximum number of chats to return
 * @property {number} snippetsPerChat Maximum number of snippets per chat
 * @property {number} timeoutMs Time budget of the whole search
 */

/**
 * Validates the body of `POST /api/chats/search-all`.
 * A query needs at least 2 characters, except when it contains a CJK character (one character is a word there).
 * @param {unknown} body Request body
 * @returns {{ ok: true, options: ChatSearchAllOptions } | { ok: false, error: string, message: string }} Parsed options or the error to report
 */
export function parseChatSearchAllRequest(body) {
    const input = (body && typeof body === 'object') ? /** @type {Record<string, unknown>} */ (body) : {};
    const query = typeof input.query === 'string' ? input.query.trim() : '';

    if (!query) {
        return { ok: false, error: 'query_required', message: 'The query is empty.' };
    }
    if (query.length > CHAT_SEARCH_ALL.maxQueryLength) {
        return { ok: false, error: 'query_too_long', message: `The query is longer than ${CHAT_SEARCH_ALL.maxQueryLength} characters.` };
    }
    if ([...query].length < 2 && !CJK_PATTERN.test(query)) {
        return { ok: false, error: 'query_too_short', message: 'The query needs at least 2 characters.' };
    }

    const terms = [...new Set(foldCase(query).split(/\s+/).filter(Boolean))];
    if (terms.length > CHAT_SEARCH_ALL.maxTerms) {
        return { ok: false, error: 'too_many_terms', message: `The query has more than ${CHAT_SEARCH_ALL.maxTerms} words.` };
    }

    const scope = input.scope === undefined || input.scope === null ? 'all' : input.scope;
    if (scope !== 'all' && scope !== 'characters' && scope !== 'groups') {
        return { ok: false, error: 'invalid_scope', message: 'The scope must be "all", "characters" or "groups".' };
    }

    return {
        ok: true,
        options: {
            terms,
            scope,
            limit: readIntegerOption(input.limit, CHAT_SEARCH_ALL.defaultLimit, 1, CHAT_SEARCH_ALL.maxLimit),
            snippetsPerChat: readIntegerOption(input.snippetsPerChat, CHAT_SEARCH_ALL.defaultSnippetsPerChat, 0, CHAT_SEARCH_ALL.maxSnippetsPerChat),
            timeoutMs: readIntegerOption(input.timeoutMs, CHAT_SEARCH_ALL.defaultTimeoutMs, 1, CHAT_SEARCH_ALL.maxTimeoutMs),
        },
    };
}

/**
 * Cuts a snippet of about 80 characters on each side of the first hit and marks every term occurrence inside it.
 * Whitespace is replaced one-to-one with spaces so the highlight ranges stay valid; "…" marks a cut-off end.
 * @param {string} text Message text
 * @param {string} foldedText `foldCase(text)`
 * @param {string[]} terms Lowercase search terms
 * @returns {{ text: string, highlights: [number, number][] } | null} Snippet, or null if no term occurs
 */
function buildChatSearchSnippet(text, foldedText, terms) {
    let firstHit = -1;
    let firstHitLength = 0;
    for (const term of terms) {
        const position = foldedText.indexOf(term);
        if (position !== -1 && (firstHit === -1 || position < firstHit)) {
            firstHit = position;
            firstHitLength = term.length;
        }
    }
    if (firstHit === -1) {
        return null;
    }

    let start = Math.max(0, firstHit - CHAT_SEARCH_ALL.snippetRadius);
    let end = Math.min(text.length, firstHit + firstHitLength + CHAT_SEARCH_ALL.snippetRadius);
    const isLowSurrogate = (/** @type {number} */ index) => {
        const code = text.charCodeAt(index);
        return code >= 0xdc00 && code <= 0xdfff;
    };
    if (start > 0 && isLowSurrogate(start)) {
        start--;
    }
    if (end < text.length && isLowSurrogate(end)) {
        end++;
    }

    const windowText = text.slice(start, end).replace(/[\r\n\t\f\v\u2028\u2029]/g, ' ');
    const foldedWindow = foldedText.slice(start, end);
    /** @type {[number, number][]} */
    const ranges = [];
    for (const term of terms) {
        let position = foldedWindow.indexOf(term);
        while (position !== -1) {
            ranges.push([position, position + term.length]);
            position = foldedWindow.indexOf(term, position + term.length);
        }
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    /** @type {[number, number][]} */
    const merged = [];
    for (const [rangeStart, rangeEnd] of ranges) {
        const previous = merged[merged.length - 1];
        if (previous && rangeStart <= previous[1]) {
            previous[1] = Math.max(previous[1], rangeEnd);
        } else {
            merged.push([rangeStart, rangeEnd]);
        }
    }

    const prefix = start > 0 ? '…' : '';
    const suffix = end < text.length ? '…' : '';
    const highlights = /** @type {[number, number][]} */ (merged
        .slice(0, CHAT_SEARCH_ALL.maxHighlightsPerSnippet)
        .map(([rangeStart, rangeEnd]) => [rangeStart + prefix.length, rangeEnd + prefix.length]));

    return { text: `${prefix}${windowText}${suffix}`, highlights };
}

/**
 * @typedef {object} ChatSearchSnippet
 * @property {number} index Position of the message among the chat's messages (approximate if the file has corrupted lines)
 * @property {string} name Speaker name
 * @property {boolean} is_user Whether the user wrote the message
 * @property {string|number} send_date Message time as stored in the chat
 * @property {string} text Message excerpt
 * @property {[number, number][]} highlights Highlighted ranges of `text`, as [start, end)
 *
 * @typedef {object} ChatSearchHit
 * @property {'character'|'group'} kind Whether the chat belongs to a character or a group
 * @property {string} [avatar] Character card file name
 * @property {string} [groupId] Group ID
 * @property {string} entityName Group name, or the card file name without extension for a character
 * @property {string} file_id Chat file name without extension
 * @property {string} file_name Chat file name with extension
 * @property {string} file_size Human-readable file size
 * @property {number} message_count Number of messages in the chat
 * @property {string|number} last_mes Time of the last message
 * @property {boolean} fileNameMatch Whether the file name contains every search term
 * @property {number} matchCount Number of messages containing at least one search term
 * @property {ChatSearchSnippet[]} snippets Excerpts of the first matching messages
 */

/**
 * Reads one chat file line by line and decides whether it matches. Only lines that contain a search term are
 * parsed, and only counts and a few excerpts are kept in memory.
 * A chat matches when every term occurs in some message (the rule of `/api/chats/search`) or the file name
 * contains every term. Corrupted lines are skipped.
 * @param {ChatFile} file Chat file
 * @param {Pick<ChatSearchAllOptions, 'terms' | 'snippetsPerChat'>} options Search options
 * @param {() => boolean} shouldStop Tells whether the search was stopped (deadline, client left, limit reached)
 * @returns {Promise<{ aborted: boolean, hit: ChatSearchHit | null }>} The hit, or null if the chat does not match
 */
function scanChatFile(file, { terms, snippetsPerChat }, shouldStop) {
    const parsedPath = path.parse(file.filePath);
    const fileNameMatch = terms.every(term => foldCase(parsedPath.name).includes(term));
    // A term that JSON.stringify would escape (quote, backslash, control character) cannot be searched in raw lines
    const canPrecheck = !terms.some(term => JSON_ESCAPED_CHARACTER_PATTERN.test(term));

    return new Promise((resolve) => {
        const input = fs.createReadStream(file.filePath, { encoding: 'utf8' });
        const lines = readline.createInterface({ input, crlfDelay: Infinity });
        const foundTerms = new Set();
        /** @type {ChatSearchSnippet[]} */
        const snippets = [];
        let isFinished = false;
        let isHeaderRead = false;
        let lineCount = 0;
        let messageCount = 0;
        let matchCount = 0;
        let lastLine = '';

        const finish = (/** @type {{ aborted: boolean, hit: ChatSearchHit | null }} */ outcome) => {
            if (isFinished) {
                return;
            }
            isFinished = true;
            lines.close();
            input.destroy();
            resolve(outcome);
        };

        input.once('error', () => finish({ aborted: false, hit: null }));
        lines.once('error', () => finish({ aborted: false, hit: null }));

        lines.on('line', (line) => {
            if (isFinished || !line) {
                return;
            }
            if (++lineCount % CHAT_SEARCH_ALL.stopCheckInterval === 0 && shouldStop()) {
                finish({ aborted: true, hit: null });
                return;
            }
            // The first line is the chat header, not a message
            if (!isHeaderRead) {
                isHeaderRead = true;
                return;
            }

            messageCount++;
            lastLine = line;
            if (canPrecheck) {
                const foldedLine = foldCase(line);
                if (!terms.some(term => foldedLine.includes(term))) {
                    return;
                }
            }

            const message = tryParse(line);
            if (!message || typeof message !== 'object') {
                return;
            }
            const text = typeof message.mes === 'string' ? message.mes : (typeof message.mes === 'number' ? String(message.mes) : '');
            if (!text) {
                return;
            }
            const foldedText = foldCase(text);
            const hitTerms = terms.filter(term => foldedText.includes(term));
            if (hitTerms.length === 0) {
                return;
            }

            matchCount++;
            hitTerms.forEach(term => foundTerms.add(term));
            if (snippets.length < snippetsPerChat) {
                const snippet = buildChatSearchSnippet(text, foldedText, terms);
                if (snippet) {
                    snippets.push({
                        index: messageCount - 1,
                        name: String(message.name ?? '').slice(0, CHAT_SEARCH_ALL.maxNameLength),
                        is_user: !!message.is_user,
                        send_date: (typeof message.send_date === 'string' || typeof message.send_date === 'number') ? message.send_date : '',
                        ...snippet,
                    });
                }
            }
        });

        lines.once('close', () => {
            if (isFinished) {
                return;
            }
            const matches = fileNameMatch || foundTerms.size === terms.length;
            if (!matches) {
                finish({ aborted: false, hit: null });
                return;
            }

            const lastMessage = lastLine ? tryParse(lastLine) : null;
            const lastSendDate = lastMessage?.send_date;
            const lastTime = (typeof lastSendDate === 'string' && lastSendDate) || (typeof lastSendDate === 'number' && lastSendDate)
                || (messageCount > 0 ? new Date(Math.round(file.mtime)).toISOString() : file.mtime);
            const isGroup = !!file.groupId;

            finish({
                aborted: false,
                hit: {
                    kind: isGroup ? 'group' : 'character',
                    ...(isGroup ? { groupId: file.groupId } : { avatar: file.pngFile }),
                    entityName: isGroup ? (file.groupName || String(file.groupId ?? '')) : String(file.pngFile).replace('.png', ''),
                    file_id: parsedPath.name,
                    file_name: parsedPath.base,
                    file_size: formatBytes(file.size),
                    message_count: messageCount,
                    last_mes: lastTime,
                    fileNameMatch,
                    matchCount,
                    snippets,
                },
            });
        });
    });
}

/**
 * Scans chat files newest first with a few files in flight at a time, until all are scanned, the limit of matching
 * chats is reached, the deadline passes or the client leaves. Results keep the newest-first order of the files.
 * @param {ChatFile[]} files Chat files, newest first
 * @param {ChatSearchAllOptions} options Search options
 * @param {{ deadline: number, isClientGone: () => boolean }} control Time budget and client connection
 * @returns {Promise<{ results: ChatSearchHit[], scannedFiles: number, partial: boolean, reason: string }>} Matching chats and how the scan ended
 */
async function scanChatFiles(files, options, { deadline, isClientGone }) {
    const total = files.length;
    /** @type {(ChatSearchHit | null | undefined)[]} */
    const outcomes = new Array(total).fill(undefined);
    /** @type {ChatSearchHit[]} */
    const results = [];
    let reason = '';
    let nextIndex = 0;
    let scannedFiles = 0;
    let settledPrefix = 0;

    const shouldStop = () => {
        if (!reason) {
            if (isClientGone()) {
                reason = 'disconnected';
            } else if (Date.now() >= deadline) {
                reason = 'timeout';
            }
        }
        return !!reason;
    };

    // Results are released in file order, so the limit always keeps the newest matching chats
    const releaseSettledResults = () => {
        while (results.length < options.limit && settledPrefix < total && outcomes[settledPrefix] !== undefined) {
            const hit = outcomes[settledPrefix++];
            if (hit) {
                results.push(hit);
            }
        }
        if (results.length >= options.limit) {
            reason = reason || 'limit';
        }
    };

    const worker = async () => {
        while (!shouldStop()) {
            const index = nextIndex++;
            if (index >= total) {
                return;
            }
            const outcome = await scanChatFile(files[index], options, shouldStop);
            if (outcome.aborted) {
                return;
            }

            scannedFiles++;
            outcomes[index] = outcome.hit;
            releaseSettledResults();
        }
    };

    await Promise.all(Array.from({ length: Math.min(CHAT_SEARCH_ALL.concurrency, total) }, worker));

    // After a timeout the older chats that were already scanned are still valid results
    if (reason === 'timeout') {
        for (let index = settledPrefix; index < total && results.length < options.limit; index++) {
            const hit = outcomes[index];
            if (hit) {
                results.push(hit);
            }
        }
    }

    // Partial: a file was never (fully) scanned, or matching chats beyond the limit were left out
    const hasUnscannedFile = outcomes.some(outcome => outcome === undefined);
    const hasHitBeyondLimit = results.length >= options.limit && outcomes.slice(settledPrefix).some(Boolean);
    const partial = hasUnscannedFile || hasHitBeyondLimit;
    return { results, scannedFiles, partial, reason: partial ? (reason || 'error') : '' };
}

export const router = express.Router();

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error
class IntegrityMismatchError extends Error {
    constructor(...params) {
        // Pass remaining arguments (including vendor specific ones) to parent constructor
        super(...params);
        // Maintains proper stack trace for where our error was thrown (non-standard)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, IntegrityMismatchError);
        }
        this.date = new Date();
    }
}

/**
 * Tries to save the chat data to a file, performing an integrity check if required.
 * @param {Array} chatData The chat array to save.
 * @param {string} filePath Target file path for the data.
 * @param {boolean} skipIntegrityCheck Whether the chat's integrity should not be checked.
 * @param {string} handle The users handle, passed to getBackupFunction.
 * @param {string} cardName Passed to backupChat.
 * @param {string} backupDirectory Passed to backupChat.
 * @returns {Promise<string|undefined>} The new integrity revision when the chat has a valid header.
 */
export async function trySaveChat(chatData, filePath, skipIntegrityCheck = false, handle, cardName, backupDirectory) {
    return CHAT_WRITE_QUEUE.run(filePath, async () => {
        const doIntegrityCheck = (checkIntegrity && !skipIntegrityCheck);
        const chatIntegritySlug = doIntegrityCheck ? chatData?.[0]?.chat_metadata?.integrity : undefined;

        if (doIntegrityCheck && !await checkChatIntegrity(filePath, chatIntegritySlug)) {
            throw new IntegrityMismatchError(`Chat integrity check failed for "${filePath}". The expected integrity slug was "${chatIntegritySlug}".`);
        }

        const storedChatData = [...chatData];
        const header = storedChatData[0];
        let integrity;
        if (header && typeof header === 'object' && !Array.isArray(header)) {
            integrity = uuidv4();
            const metadata = header.chat_metadata && typeof header.chat_metadata === 'object' && !Array.isArray(header.chat_metadata) ? header.chat_metadata : {};
            storedChatData[0] = { ...header, chat_metadata: { ...metadata, integrity } };
        }

        const jsonlData = storedChatData.map(m => JSON.stringify(m)).join('\n');
        tryWriteFileSync(filePath, jsonlData);
        getBackupFunction(handle)(backupDirectory, cardName, jsonlData);
        return integrity;
    });
}

router.post('/save', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const handle = request.user.profile.handle;
        const cardName = String(request.body.avatar_url).replace('.png', '');
        const chatData = request.body.chat;
        const chatFileName = `${String(request.body.file_name)}.jsonl`;
        const chatFilePath = path.join(request.user.directories.chats, cardName, sanitize(chatFileName));
        if (!isPathUnderParent(request.user.directories.chats, chatFilePath)) {
            return response.sendStatus(400);
        }

        if (Array.isArray(chatData)) {
            const integrity = await trySaveChat(chatData, chatFilePath, request.body.force, handle, cardName, request.user.directories.backups);
            return response.send({ ok: true, integrity });
        } else {
            return response.status(400).send({ error: 'The request\'s body.chat is not an array.' });
        }
    } catch (error) {
        if (error instanceof IntegrityMismatchError) {
            console.error(error.message);
            return response.status(400).send({ error: 'integrity' });
        }
        console.error(error);
        return response.status(500).send({ error: 'An error has occurred, see the console logs for more information.' });
    }
});

/**
 * Gets the chat as an object.
 * @param {string} chatFilePath The full chat file path.
 * @returns {Array}} If the chatFilePath cannot be read, this will return [].
 */
export function getChatData(chatFilePath) {
    let chatData = [];

    const chatJSON = tryReadFileSync(chatFilePath) ?? '';
    if (chatJSON.length > 0) {
        const lines = chatJSON.split('\n');
        // Iterate through the array of strings and parse each line as JSON
        chatData = lines.map(line => tryParse(line)).filter(x => x);
    } else {
        console.warn(`File not found: ${chatFilePath}. The chat does not exist or is empty.`);
    }

    return chatData;
}

router.post('/get', validateAvatarUrlMiddleware, function (request, response) {
    try {
        const dirName = String(request.body.avatar_url).replace('.png', '');
        const directoryPath = path.join(request.user.directories.chats, dirName);
        if (!isPathUnderParent(request.user.directories.chats, directoryPath)) {
            return response.sendStatus(400);
        }
        const chatDirExists = fs.existsSync(directoryPath);

        //if no chat dir for the character is found, make one with the character name
        if (!chatDirExists) {
            fs.mkdirSync(directoryPath);
            return response.send({});
        }

        if (!request.body.file_name) {
            return response.send({});
        }

        const chatFileName = `${String(request.body.file_name)}.jsonl`;
        const chatFilePath = path.join(directoryPath, sanitize(chatFileName));

        return response.send(getChatData(chatFilePath));
    } catch (error) {
        console.error(error);
        return response.send({});
    }
});

router.post('/rename', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        if (!request.body || !request.body.original_file || !request.body.renamed_file) {
            return response.sendStatus(400);
        }

        const pathToFolder = request.body.is_group
            ? request.user.directories.groupChats
            : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
        if (!request.body.is_group && !isPathUnderParent(request.user.directories.chats, pathToFolder)) {
            return response.sendStatus(400);
        }
        const pathToOriginalFile = path.join(pathToFolder, sanitize(request.body.original_file));
        const pathToRenamedFile = path.join(pathToFolder, sanitize(request.body.renamed_file));
        const sanitizedFileName = path.parse(pathToRenamedFile).name;
        console.debug('Old chat name', pathToOriginalFile);
        console.debug('New chat name', pathToRenamedFile);

        if (!fs.existsSync(pathToOriginalFile)) {
            console.error('Source chat file is not available');
            return response.status(404).send({ error: 'source_missing' });
        }
        if (fs.existsSync(pathToRenamedFile)) {
            console.error('Destination chat file already exists');
            return response.status(409).send({ error: 'destination_exists' });
        }

        fs.copyFileSync(pathToOriginalFile, pathToRenamedFile);
        fs.unlinkSync(pathToOriginalFile);
        console.info('Successfully renamed chat file.');
        return response.send({ ok: true, sanitizedFileName });
    } catch (error) {
        console.error('Error renaming chat file:', error);
        return response.status(500).send({ error: true });
    }
});

router.post('/delete', validateAvatarUrlMiddleware, function (request, response) {
    try {
        if (!request.body?.avatar_url || !request.body?.chatfile) {
            return response.sendStatus(400);
        }

        const dirName = String(request.body.avatar_url).replace('.png', '');
        const requestedChatFile = String(request.body.chatfile);
        const chatFileName = path.extname(requestedChatFile) ? requestedChatFile : `${requestedChatFile}.jsonl`;
        const chatFilePath = path.join(request.user.directories.chats, dirName, sanitize(chatFileName));
        if (!isPathUnderParent(request.user.directories.chats, chatFilePath)) {
            return response.sendStatus(400);
        }
        if (!fs.existsSync(chatFilePath)) {
            return response.send({ ok: true, missing: true });
        }
        //Return success if the file was deleted.
        if (tryDeleteFile(chatFilePath)) {
            return response.send({ ok: true });
        }
        if (!fs.existsSync(chatFilePath)) {
            return response.send({ ok: true, missing: true });
        }
        console.error('The chat file was not deleted.');
        return response.sendStatus(500);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/export', validateAvatarUrlMiddleware, async function (request, response) {
    if (!request.body.file || (!request.body.avatar_url && request.body.is_group === false)) {
        return response.sendStatus(400);
    }
    const pathToFolder = request.body.is_group
        ? request.user.directories.groupChats
        : path.join(request.user.directories.chats, String(request.body.avatar_url).replace('.png', ''));
    const filename = path.join(pathToFolder, sanitize(request.body.file));
    if (!request.body.is_group && !isPathUnderParent(request.user.directories.chats, filename)) {
        return response.sendStatus(400);
    }
    let exportfilename = request.body.exportfilename;
    if (!fs.existsSync(filename)) {
        const errorMessage = {
            message: `Could not find JSONL file to export. Source chat file: ${filename}.`,
        };
        console.error(errorMessage.message);
        return response.status(404).json(errorMessage);
    }
    try {
        // Short path for JSONL files
        if (request.body.format === 'jsonl') {
            try {
                const rawFile = fs.readFileSync(filename, 'utf8');
                const successMessage = {
                    message: `Chat saved to ${exportfilename}`,
                    result: rawFile,
                };

                console.info(`Chat exported as ${exportfilename}`);
                return response.status(200).json(successMessage);
            } catch (err) {
                console.error(err);
                const errorMessage = {
                    message: `Could not read JSONL file to export. Source chat file: ${filename}.`,
                };
                console.error(errorMessage.message);
                return response.status(500).json(errorMessage);
            }
        }

        let buffer = '';
        await new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(filename);
            const rl = readline.createInterface({ input: readStream });
            let settled = false;

            const fail = (error) => {
                if (settled) {
                    return;
                }

                settled = true;
                rl.close();
                readStream.destroy();
                reject(error);
            };

            readStream.on('error', fail);
            rl.on('line', (line) => {
                if (settled) {
                    return;
                }

                try {
                    const data = JSON.parse(line);
                    // Skip non-printable/prompt-hidden messages
                    if (data.is_system) {
                        return;
                    }
                    if (data.mes) {
                        const name = data.name;
                        const message = (data?.extra?.display_text || data?.mes || '').replace(/\r?\n/g, '\n');
                        buffer += (`${name}: ${message}\n\n`);
                    }
                } catch (error) {
                    fail(error);
                }
            });
            rl.on('close', () => {
                if (settled) {
                    return;
                }

                settled = true;
                resolve();
            });
        });

        const successMessage = {
            message: `Chat saved to ${exportfilename}`,
            result: buffer,
        };
        console.info(`Chat exported as ${exportfilename}`);
        return response.status(200).json(successMessage);
    } catch (err) {
        console.error('chat export failed.', err);
        return response.sendStatus(400);
    }
});

router.post('/group/import', function (request, response) {
    try {
        const filedata = request.file;

        if (!filedata) {
            return response.sendStatus(400);
        }

        const chatname = humanizedDateTime();
        const pathToUpload = path.join(filedata.destination, filedata.filename);
        const pathToNewFile = path.join(request.user.directories.groupChats, `${chatname}.jsonl`);
        fs.copyFileSync(pathToUpload, pathToNewFile);
        fs.unlinkSync(pathToUpload);
        return response.send({ res: chatname });
    } catch (error) {
        console.error(error);
        return response.send({ error: true });
    }
});

router.post('/import', validateAvatarUrlMiddleware, function (request, response) {
    if (!request.body) return response.sendStatus(400);

    const format = request.body.file_type;
    const avatarUrl = (request.body.avatar_url).replace('.png', '');
    const characterName = sanitize(request.body.character_name) || 'Character';
    const userName = sanitize(request.body.user_name) || 'User';
    const fileNames = [];

    if (!request.file) {
        return response.sendStatus(400);
    }

    const directoryPath = path.join(request.user.directories.chats, avatarUrl);
    if (!isPathUnderParent(request.user.directories.chats, directoryPath)) {
        return response.sendStatus(400);
    }

    try {
        const pathToUpload = path.join(request.file.destination, request.file.filename);
        const data = fs.readFileSync(pathToUpload, 'utf8');

        if (format === 'json') {
            fs.unlinkSync(pathToUpload);
            const jsonData = JSON.parse(data);

            /** @type {function(string, string, object): string|string[]} */
            let importFunc;

            if (jsonData.savedsettings !== undefined) { // Kobold Lite format
                importFunc = importKoboldLiteChat;
            } else if (jsonData.histories !== undefined) { // CAI Tools format
                importFunc = importCAIChat;
            } else if (Array.isArray(jsonData.data_visible)) { // oobabooga's format
                importFunc = importOobaChat;
            } else if (Array.isArray(jsonData.messages)) { // Agnai's format
                importFunc = importAgnaiChat;
            } else if (jsonData.type === 'risuChat') { // RisuAI format
                importFunc = importRisuChat;
            } else { // Unknown format
                console.error('Incorrect chat format .json');
                return response.send({ error: true });
            }

            const handleChat = (chat) => {
                const fileName = `${characterName} - ${humanizedDateTime()} imported.jsonl`;
                const filePath = path.join(directoryPath, fileName);
                fileNames.push(fileName);
                writeFileAtomicSync(filePath, chat, 'utf8');
            };

            const chat = importFunc(userName, characterName, jsonData);

            if (Array.isArray(chat)) {
                chat.forEach(handleChat);
            } else {
                handleChat(chat);
            }

            return response.send({ res: true, fileNames });
        }

        if (format === 'jsonl') {
            let lines = data.split('\n');
            const header = lines[0];

            const jsonData = JSON.parse(header);

            if (!(jsonData.user_name !== undefined || jsonData.name !== undefined || jsonData.chat_metadata !== undefined)) {
                console.error('Incorrect chat format .jsonl');
                return response.send({ error: true });
            }

            // Do a tiny bit of work to import Chub Chat data
            // Processing the entire file is so fast that it's not worth checking if it's a Chub chat first
            let flattenedChat = data;
            try {
                // flattening is unlikely to break, but it's not worth failing to
                // import normal chats in an attempt to import a Chub chat
                flattenedChat = flattenChubChat(userName, characterName, lines);
            } catch (error) {
                console.warn('Failed to flatten Chub Chat data: ', error);
            }

            const fileName = `${characterName} - ${humanizedDateTime()} imported.jsonl`;
            const filePath = path.join(directoryPath, fileName);
            fileNames.push(fileName);
            if (flattenedChat !== data) {
                writeFileAtomicSync(filePath, flattenedChat, 'utf8');
            } else {
                fs.copyFileSync(pathToUpload, filePath);
            }
            fs.unlinkSync(pathToUpload);
            response.send({ res: true, fileNames });
        }
    } catch (error) {
        console.error(error);
        return response.send({ error: true });
    }
});

router.post('/group/get', (request, response) => {
    if (!request.body || !request.body.id) {
        return response.sendStatus(400);
    }

    const id = request.body.id;
    const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));

    return response.send(getChatData(chatFilePath));
});

router.post('/group/info', async (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));

        const chatInfo = await getChatInfo(chatFilePath);
        return response.send(chatInfo);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return response.sendStatus(404);
        }
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/group/delete', (request, response) => {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));

        if (!fs.existsSync(chatFilePath)) {
            return response.send({ ok: true, missing: true });
        }
        //Return success if the file was deleted.
        if (tryDeleteFile(chatFilePath)) {
            return response.send({ ok: true });
        }
        if (!fs.existsSync(chatFilePath)) {
            return response.send({ ok: true, missing: true });
        }
        console.error('The group chat file was not deleted.');
        return response.sendStatus(500);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/group/save', async function (request, response) {
    try {
        if (!request.body || !request.body.id) {
            return response.sendStatus(400);
        }

        const id = request.body.id;
        const handle = request.user.profile.handle;
        const chatFilePath = path.join(request.user.directories.groupChats, sanitize(`${id}.jsonl`));
        const chatData = request.body.chat;

        if (Array.isArray(chatData)) {
            const integrity = await trySaveChat(chatData, chatFilePath, request.body.force, handle, String(id), request.user.directories.backups);
            return response.send({ ok: true, integrity });
        } else {
            return response.status(400).send({ error: 'The request\'s body.chat is not an array.' });
        }
    } catch (error) {
        if (error instanceof IntegrityMismatchError) {
            console.error(error.message);
            return response.status(400).send({ error: 'integrity' });
        }
        console.error(error);
        return response.status(500).send({ error: 'An error has occurred, see the console logs for more information.' });
    }
});

router.post('/search', validateAvatarUrlMiddleware, async function (request, response) {
    try {
        const { query, avatar_url, group_id } = request.body;

        /** @type {string[]} */
        let chatFiles = [];

        if (group_id) {
            // Find group's chat IDs first
            const groupDir = path.join(request.user.directories.groups);
            const groupFiles = fs.readdirSync(groupDir)
                .filter(file => path.extname(file) === '.json');

            let targetGroup;
            for (const groupFile of groupFiles) {
                try {
                    const groupData = JSON.parse(fs.readFileSync(path.join(groupDir, groupFile), 'utf8'));
                    if (groupData.id === group_id) {
                        targetGroup = groupData;
                        break;
                    }
                } catch (error) {
                    console.warn(groupFile, 'group file is corrupted:', error);
                }
            }

            if (!Array.isArray(targetGroup?.chats)) {
                return response.send([]);
            }

            // Find group chat files for given group ID
            const groupChatsDir = request.user.directories.groupChats;
            chatFiles = targetGroup.chats
                .map(chatId => getGroupChatFilePath(groupChatsDir, chatId))
                .filter(fileName => fileName && fs.existsSync(fileName));
        } else {
            // Regular character chat directory
            const character_name = avatar_url.replace('.png', '');
            const directoryPath = path.join(request.user.directories.chats, character_name);

            if (!fs.existsSync(directoryPath)) {
                return response.send([]);
            }

            chatFiles = fs.readdirSync(directoryPath)
                .filter(file => path.extname(file) === '.jsonl')
                .map(fileName => path.join(directoryPath, fileName));
        }

        /**
         * @type {SearchChatResult[]}
         * @typedef {object} SearchChatResult
         * @property {string} [file_name] - The name of the chat file
         * @property {string} [file_size] - The size of the chat file in a human-readable format
         * @property {number} [message_count] - The number of messages in the chat
         * @property {number|string} [last_mes] - The timestamp of the last message
         * @property {string} [preview_message] - A preview of the last message
         */
        const results = [];

        /** @type {string[]} */
        const fragments = query ? query.trim().toLowerCase().split(/\s+/).filter(x => x) : [];

        /** @type {ChatMatchFunction} */
        const hasTextMatch = (textArray) => {
            if (fragments.length === 0) {
                return true;
            }
            return fragments.every(fragment => textArray.some(text => String(text ?? '').toLowerCase().includes(fragment)));
        };

        for (const chatFile of chatFiles) {
            const matcher = query ? hasTextMatch : null;
            const chatInfo = await getChatInfo(chatFile, {}, false, matcher);
            const hasMatch = chatInfo.match || hasTextMatch([chatInfo.file_id ?? '']);

            // Skip corrupted or invalid chat files
            if (!chatInfo.file_name) {
                continue;
            }

            // Empty chats without a file name match are skipped when searching with a query
            if (query && chatInfo.chat_items === 0 && !hasMatch) {
                continue;
            }

            // If no search query or a match was found, include the chat in results
            if (!query || hasMatch) {
                results.push({
                    file_name: chatInfo.file_id,
                    file_size: chatInfo.file_size,
                    message_count: chatInfo.chat_items,
                    last_mes: chatInfo.last_mes,
                    preview_message: getPreviewMessage(chatInfo.mes),
                });
            }
        }

        return response.send(results);
    } catch (error) {
        console.error('Chat search error:', error);
        return response.status(500).json({ error: 'Search failed' });
    }
});

router.post('/search-all', async function (request, response) {
    const parsed = parseChatSearchAllRequest(request.body);
    if (!parsed.ok) {
        return response.status(400).send({ error: parsed.error, message: parsed.message });
    }

    const { options } = parsed;
    const startedAt = Date.now();
    let isClientGone = false;
    // Node emits 'close' on the request as soon as its body has been read, so only the response tells a real disconnect
    if (typeof response.on === 'function') {
        response.on('close', () => {
            if (!response.writableFinished) {
                isClientGone = true;
            }
        });
    }

    try {
        const listedFiles = await listUserChatFiles(request.user.directories, {
            characters: options.scope !== 'groups',
            groups: options.scope !== 'characters',
        });
        // Chats without an owner (a group without ID) can't be opened from a search result
        const files = listedFiles
            .filter(file => file.pngFile || file.groupId)
            .sort((a, b) => b.mtime - a.mtime || a.filePath.localeCompare(b.filePath));
        const scan = await scanChatFiles(files, options, {
            deadline: startedAt + options.timeoutMs,
            isClientGone: () => isClientGone,
        });
        if (isClientGone) {
            return;
        }

        return response.send({
            results: scan.results,
            scannedFiles: scan.scannedFiles,
            totalFiles: files.length,
            partial: scan.partial,
            partialReason: scan.reason,
            elapsedMs: Date.now() - startedAt,
        });
    } catch (error) {
        console.error('Chat search-all error:', error);
        return response.status(500).json({ error: 'Search failed' });
    }
});

router.post('/recent', async function (request, response) {
    try {
        /** @type {ChatFile[]} */
        const allChatFiles = await listUserChatFiles(request.user.directories, { root: true });
        /** @type {import('../../public/scripts/welcome-screen.js').PinnedChat[]} */
        const pinnedChats = Array.isArray(request.body.pinned) ? request.body.pinned : [];

        const max = parseInt(request.body.max ?? Number.MAX_SAFE_INTEGER) + pinnedChats.length;
        const isPinned = (/** @type {ChatFile} */ chatFile) => pinnedChats.some(p => p.file_name === path.basename(chatFile.filePath) && (p.avatar === chatFile.pngFile || p.group === chatFile.groupId));
        const recentChats = allChatFiles.sort((a, b) => {
            const isAPinned = isPinned(a);
            const isBPinned = isPinned(b);

            if (isAPinned && !isBPinned) return -1;
            if (!isAPinned && isBPinned) return 1;

            return b.mtime - a.mtime;
        }).slice(0, max);
        const jsonFilesPromise = recentChats.map((file) => {
            const withMetadata = !!request.body.metadata;
            return file.groupId
                ? getChatInfo(file.filePath, { group: file.groupId }, withMetadata)
                : getChatInfo(file.filePath, { avatar: file.pngFile }, withMetadata);
        });

        const chatData = (await Promise.allSettled(jsonFilesPromise)).filter(x => x.status === 'fulfilled').map(x => x.value);
        const validFiles = chatData.filter(i => i.file_name);

        return response.send(validFiles);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

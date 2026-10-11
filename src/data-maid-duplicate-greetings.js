import fs from 'node:fs';
import path from 'node:path';
import { getFileIdentity, matchesFileIdentity } from './file-identity.js';
import { isPathUnderParent } from './util.js';
import { parse as parseCharacterCard } from './character-card-parser.js';

/**
 * Detection and quarantine of "greeting-only" duplicate chats.
 *
 * Before the Modern UI created its own chat file on first open, the hidden legacy engine also created
 * `<Character> - <date>.jsonl` holding nothing but the character's greeting, next to the `Modern <ISO>.jsonl` file.
 * Those leftovers are listed here only when every condition below holds, and they are MOVED to a quarantine folder, never deleted.
 */

/** Legacy chat file name: `<card name> - 2026-09-04@12h30m45s123ms.jsonl` (local time, no zone, so it is never used as a time source). */
export const LEGACY_CHAT_FILE_REGEXP = /^(.+) - \d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s\d{3}ms\.jsonl$/;
/** Modern chat file name: `Modern 2026-09-04T12-30-45-123Z.jsonl` (UTC). */
export const MODERN_CHAT_FILE_REGEXP = /^Modern (\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.jsonl$/;
/** How far apart the greeting's `send_date` and the Modern file's time may be. */
export const MODERN_SIBLING_WINDOW_MS = 30 * 60 * 1000;
/** A greeting-only chat is tiny; a bigger file is not read at all. */
export const MAX_CANDIDATE_FILE_BYTES = 256 * 1024;
/** Upper bound for reading a Modern sibling to check its content. */
export const MAX_SIBLING_FILE_BYTES = 32 * 1024 * 1024;
/** Report lifetime: a token older than this is refused. */
export const DUPLICATE_GREETING_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Keys a freshly generated greeting message has (`script.js` getFirstMessage plus the engine's own bookkeeping). */
const GREETING_MESSAGE_KEYS = new Set(['name', 'is_user', 'is_system', 'send_date', 'mes', 'extra', 'swipe_id', 'swipes', 'swipe_info', 'original_avatar', 'force_avatar']);
const GREETING_SWIPE_INFO_KEYS = new Set(['send_date', 'gen_started', 'gen_finished', 'extra']);
/** `extra` keys that carry no user content. Anything else (media, files, reasoning, display_text, ...) disqualifies the chat. */
const BENIGN_EXTRA_KEYS = new Set(['token_count', 'api', 'model']);
/** `chat_metadata` keys the engine writes on its own, with the value type that keeps them harmless. Other keys qualify only when empty. */
const SYSTEM_METADATA_VALIDATORS = Object.freeze({
    integrity: value => typeof value === 'string',
    chat_id_hash: value => typeof value === 'number' || typeof value === 'string',
    lastInContextMessageId: value => typeof value === 'number',
});

/**
 * @typedef {object} GreetingCard
 * @property {string[]} names Names the card goes by (`name` and `data.name`).
 * @property {string[]} greetings `first_mes` followed by the alternate greetings, empty ones removed.
 * @property {string} chat File name (without extension) the card points to as its current chat.
 */

/**
 * @typedef {object} GreetingContext
 * @property {string[]} userNames Names `{{user}}` may have been replaced with.
 */

/**
 * @typedef {object} DuplicateGreetingCandidate
 * @property {string} avatarBase Character file name without `.png`.
 * @property {string} fileName Chat file name (with extension).
 * @property {string} filePath Absolute path (server side only).
 * @property {import('./file-identity.js').FileIdentity} identity Identity of the chat file when it was inspected.
 * @property {string} characterName Card name.
 * @property {number} greetingIndex Index of the greeting the message holds (0 is `first_mes`).
 * @property {number} swipeCount Number of greeting candidates stored in the message.
 * @property {string} preview Beginning of the greeting text.
 * @property {number} sendMs Greeting `send_date` as epoch milliseconds.
 * @property {boolean} isCardChat Whether the character card points at this chat.
 * @property {{ fileName: string, filePath: string, identity: import('./file-identity.js').FileIdentity, messageCount: number, startsWithSameGreeting: boolean, timeDeltaMs: number }} modern The sibling Modern chat that makes this one redundant.
 */

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
    return String(value).replace(/\r\n?/g, '\n').trim();
}

/**
 * True for values that hold no user data: nothing, an empty string, or arrays and objects that contain only such values.
 * @param {any} value Value to test.
 * @returns {boolean} Whether the value is empty all the way down.
 */
export function isEmptyDeep(value) {
    if (value === null || value === undefined || value === '') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every(isEmptyDeep);
    }
    if (isPlainObject(value)) {
        return Object.values(value).every(isEmptyDeep);
    }
    return false;
}

/**
 * Whether a chat header carries nothing a user put there: only engine bookkeeping keys, or empty values.
 * Background locks (`custom_background`, `chat_backgrounds`), attachments, a non-empty author's note and similar settings disqualify.
 * @param {any} metadata `chat_metadata` of the chat header.
 * @returns {boolean} True if the metadata holds no user data.
 */
export function isMetadataWithoutUserData(metadata) {
    if (metadata === undefined || metadata === null) {
        return true;
    }
    if (!isPlainObject(metadata)) {
        return false;
    }
    return Object.entries(metadata).every(([key, value]) => {
        const validator = SYSTEM_METADATA_VALIDATORS[/** @type {keyof typeof SYSTEM_METADATA_VALIDATORS} */ (key)];
        return isEmptyDeep(value) || (validator ? validator(value) : false);
    });
}

/**
 * Splits chat file text into its header and messages.
 * @param {string} text File content.
 * @param {{ tolerant?: boolean }} [options] `tolerant` skips unparseable lines instead of rejecting the file.
 * @returns {{ header: any, messages: any[] } | null} Parsed chat, or null if a line is not valid JSON (strict mode).
 */
export function parseChatText(text, { tolerant = false } = {}) {
    const entries = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            entries.push(JSON.parse(trimmed));
        } catch {
            if (!tolerant) {
                return null;
            }
        }
    }

    const first = entries[0];
    const hasHeader = isPlainObject(first) && !Object.hasOwn(first, 'mes')
        && (Object.hasOwn(first, 'chat_metadata') || Object.hasOwn(first, 'user_name') || Object.hasOwn(first, 'character_name'));
    return { header: hasHeader ? first : null, messages: hasHeader ? entries.slice(1) : entries };
}

/**
 * Text variants a greeting may be stored as: raw, and with `{{char}}` / `{{user}}` replaced.
 * @param {string} greeting Greeting from the card.
 * @param {string} charName Card name.
 * @param {GreetingContext} context Known user names.
 * @returns {Set<string>} Normalized variants.
 */
function getGreetingVariants(greeting, charName, context) {
    const variants = new Set([normalizeText(greeting)]);
    const withChar = greeting.replace(/\{\{char\}\}/gi, charName).replace(/<BOT>/gi, charName);
    variants.add(normalizeText(withChar));
    for (const userName of context.userNames) {
        const replaceUser = text => text.replace(/\{\{user\}\}/gi, userName).replace(/<USER>/gi, userName);
        variants.add(normalizeText(replaceUser(greeting)));
        variants.add(normalizeText(replaceUser(withChar)));
    }
    return variants;
}

/**
 * Finds which greeting of the card a text is.
 * @param {string} text Message text.
 * @param {GreetingCard} card Card greetings.
 * @param {GreetingContext} context Known user names.
 * @returns {number} Index into `card.greetings`, or -1.
 */
export function findGreetingIndex(text, card, context) {
    if (typeof text !== 'string') {
        return -1;
    }
    const normalized = normalizeText(text);
    if (!normalized) {
        return -1;
    }
    const charName = card.names[0] ?? '';
    return card.greetings.findIndex(greeting => getGreetingVariants(greeting, charName, context).has(normalized));
}

function isBenignExtra(extra) {
    if (extra === undefined || extra === null) {
        return true;
    }
    return isPlainObject(extra) && Object.keys(extra).every(key => BENIGN_EXTRA_KEYS.has(key));
}

/**
 * Checks the single message of a candidate chat: a character message that holds only a greeting of the card.
 * @param {any} message The chat message.
 * @param {GreetingCard} card Card greetings.
 * @param {GreetingContext} context Known user names.
 * @returns {{ ok: true, greetingIndex: number, swipeCount: number } | { ok: false, reason: string }} Verdict.
 */
function inspectGreetingMessage(message, card, context) {
    if (!isPlainObject(message)) {
        return { ok: false, reason: 'message-shape' };
    }
    if (message.is_user === true || message.is_system === true) {
        return { ok: false, reason: 'user-or-system' };
    }
    if (message.extra?.api === 'modern') {
        return { ok: false, reason: 'modern-source' };
    }
    if (!Object.keys(message).every(key => GREETING_MESSAGE_KEYS.has(key)) || typeof message.mes !== 'string' || !message.mes.trim()) {
        return { ok: false, reason: 'message-shape' };
    }
    if (!isBenignExtra(message.extra)) {
        return { ok: false, reason: 'media-or-extra' };
    }

    const greetingIndex = findGreetingIndex(message.mes, card, context);
    if (greetingIndex < 0) {
        return { ok: false, reason: 'not-greeting' };
    }

    if (message.swipes === undefined) {
        if (message.swipe_id !== undefined || message.swipe_info !== undefined) {
            return { ok: false, reason: 'message-shape' };
        }
        return { ok: true, greetingIndex, swipeCount: 1 };
    }

    const { swipes } = message;
    if (!Array.isArray(swipes) || swipes.length === 0 || swipes.length > card.greetings.length) {
        return { ok: false, reason: 'not-greeting' };
    }
    if (!swipes.every(swipe => findGreetingIndex(swipe, card, context) >= 0)) {
        return { ok: false, reason: 'not-greeting' };
    }
    const swipeId = message.swipe_id ?? 0;
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId >= swipes.length || normalizeText(swipes[swipeId]) !== normalizeText(message.mes)) {
        return { ok: false, reason: 'not-greeting' };
    }
    if (message.swipe_info !== undefined) {
        const info = message.swipe_info;
        const infoIsHarmless = Array.isArray(info) && info.length <= swipes.length && info.every(item => isPlainObject(item)
            && Object.keys(item).every(key => GREETING_SWIPE_INFO_KEYS.has(key))
            && item.extra?.api !== 'modern'
            && isBenignExtra(item.extra));
        if (!infoIsHarmless) {
            return { ok: false, reason: 'media-or-extra' };
        }
    }
    return { ok: true, greetingIndex, swipeCount: swipes.length };
}

/**
 * Parses the `send_date` of the greeting into epoch milliseconds. Only unambiguous values count: an ISO string with a date and
 * time (as the engine and Modern write them) or an epoch number. A locale string without a zone could be off by hours.
 * @param {any} value `send_date` value.
 * @returns {number} Epoch milliseconds, or NaN.
 */
export function parseSendDate(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
        return Date.parse(value);
    }
    return NaN;
}

/**
 * Pure part of the rule: decides from a legacy chat file's name and text whether it is a greeting-only chat of this card.
 * It does not look at the file system, so the Modern sibling and the card pointer are checked separately.
 * @param {{ fileName: string, text: string, card: GreetingCard, context: GreetingContext }} input Chat file name and text, card and known user names.
 * @returns {{ ok: true, greetingIndex: number, swipeCount: number, sendMs: number, preview: string, characterName: string } | { ok: false, reason: string }} Verdict.
 */
export function analyzeLegacyGreetingChat({ fileName, text, card, context }) {
    const nameMatch = LEGACY_CHAT_FILE_REGEXP.exec(fileName);
    if (!nameMatch) {
        return { ok: false, reason: 'file-name' };
    }
    if (!card.names.includes(nameMatch[1])) {
        return { ok: false, reason: 'name-mismatch' };
    }

    const parsed = parseChatText(text);
    if (!parsed) {
        return { ok: false, reason: 'unparseable' };
    }
    if (!parsed.header) {
        return { ok: false, reason: 'no-header' };
    }
    if (parsed.messages.length !== 1) {
        return { ok: false, reason: 'message-count' };
    }

    const verdict = inspectGreetingMessage(parsed.messages[0], card, context);
    if (!verdict.ok) {
        return verdict;
    }
    if (!isMetadataWithoutUserData(parsed.header.chat_metadata)) {
        return { ok: false, reason: 'metadata' };
    }

    const sendMs = parseSendDate(parsed.messages[0].send_date);
    if (!Number.isFinite(sendMs)) {
        return { ok: false, reason: 'send-date' };
    }

    return {
        ok: true,
        greetingIndex: verdict.greetingIndex,
        swipeCount: verdict.swipeCount,
        sendMs,
        preview: normalizeText(parsed.messages[0].mes).slice(0, 240),
        characterName: nameMatch[1],
    };
}

/**
 * Reads a character card PNG and extracts what the rule needs.
 * @param {string} pngPath Path of the character card.
 * @returns {Promise<GreetingCard | null>} Card summary, or null if the card cannot be read.
 */
export async function readGreetingCard(pngPath) {
    try {
        const card = JSON.parse(await parseCharacterCard(pngPath, 'png'));
        const data = isPlainObject(card?.data) ? card.data : card;
        const strings = values => values.filter(value => typeof value === 'string');
        const names = [...new Set(strings([data?.name, card?.name]))].filter(Boolean);
        const alternateGreetings = Array.isArray(data?.alternate_greetings) ? strings(data.alternate_greetings) : [];
        const greetings = [...new Set(strings([card?.first_mes, data?.first_mes]).filter(value => value.trim()))];
        greetings.push(...alternateGreetings.filter(value => value.trim()));
        return {
            names,
            greetings,
            chat: typeof card?.chat === 'string' ? card.chat.replace(/\.jsonl$/i, '') : '',
        };
    } catch {
        return null;
    }
}

/**
 * Collects the names `{{user}}` may have been replaced with: the account's user name and persona names.
 * @param {string} root User data root.
 * @returns {Promise<GreetingContext>} Known user names.
 */
export async function readGreetingContext(root) {
    const userNames = new Set(['User']);
    try {
        const settings = JSON.parse(await fs.promises.readFile(path.join(root, 'settings.json'), 'utf8'));
        if (typeof settings?.username === 'string') {
            userNames.add(settings.username);
        }
        for (const name of Object.values(settings?.power_user?.personas ?? {})) {
            if (typeof name === 'string') {
                userNames.add(name);
            }
        }
    } catch {
        // Without settings the default name is all there is.
    }
    return { userNames: [...userNames].filter(Boolean) };
}

async function isRegularFile(filePath) {
    try {
        return (await fs.promises.lstat(filePath)).isFile();
    } catch {
        return false;
    }
}

/**
 * Creates an inspector that applies the full rule to chat files of one user, caching cards and directory listings per avatar.
 * @param {import('./users.js').UserDirectoryList} directories User directories.
 * @param {object} [options] Options.
 * @param {(pngPath: string) => Promise<GreetingCard | null>} [options.readCard] Card reader, replaceable for tests.
 * @returns {{ inspect: (avatarBase: string, fileName: string) => Promise<{ ok: true, candidate: DuplicateGreetingCandidate } | { ok: false, reason: string }> }} Inspector.
 */
export function createDuplicateGreetingInspector(directories, { readCard = readGreetingCard } = {}) {
    /** @type {Map<string, Promise<GreetingCard | null>>} */
    const cards = new Map();
    /** @type {Map<string, Promise<{ modernFiles: { fileName: string, timeMs: number }[] }>>} */
    const listings = new Map();
    /** @type {Promise<GreetingContext> | null} */
    let contextPromise = null;

    function getCard(avatarBase) {
        if (!cards.has(avatarBase)) {
            cards.set(avatarBase, (async () => {
                const pngPath = path.join(directories.characters, `${avatarBase}.png`);
                return await isRegularFile(pngPath) ? readCard(pngPath) : null;
            })());
        }
        return /** @type {Promise<GreetingCard | null>} */ (cards.get(avatarBase));
    }

    function getListing(avatarBase) {
        if (!listings.has(avatarBase)) {
            listings.set(avatarBase, (async () => {
                const dirents = await fs.promises.readdir(path.join(directories.chats, avatarBase), { withFileTypes: true }).catch(() => []);
                const modernFiles = [];
                for (const dirent of dirents) {
                    const match = dirent.isFile() ? MODERN_CHAT_FILE_REGEXP.exec(dirent.name) : null;
                    if (match) {
                        const [year, month, day, hour, minute, second, millisecond] = match.slice(1).map(Number);
                        modernFiles.push({ fileName: dirent.name, timeMs: Date.UTC(year, month - 1, day, hour, minute, second, millisecond) });
                    }
                }
                return { modernFiles };
            })());
        }
        return /** @type {Promise<{ modernFiles: { fileName: string, timeMs: number }[] }>} */ (listings.get(avatarBase));
    }

    async function findModernSibling(avatarBase, analysis, card, context) {
        const { modernFiles } = await getListing(avatarBase);
        const nearby = modernFiles
            .map(file => ({ ...file, delta: Math.abs(file.timeMs - analysis.sendMs) }))
            .filter(file => file.delta <= MODERN_SIBLING_WINDOW_MS)
            .sort((a, b) => a.delta - b.delta);

        for (const file of nearby) {
            const filePath = path.join(directories.chats, avatarBase, file.fileName);
            const identity = getFileIdentity(filePath);
            if (!identity || identity.size > MAX_SIBLING_FILE_BYTES) {
                continue;
            }

            let parsed;
            try {
                parsed = parseChatText(await fs.promises.readFile(filePath, 'utf8'), { tolerant: true });
            } catch {
                continue;
            }
            const messages = parsed?.messages ?? [];
            const first = messages[0];
            const startsWithSameGreeting = isPlainObject(first) && first.is_user !== true && first.is_system !== true
                && findGreetingIndex(first.mes, card, context) === analysis.greetingIndex;
            if (messages.length >= 2 || startsWithSameGreeting) {
                return { fileName: file.fileName, filePath, identity, messageCount: messages.length, startsWithSameGreeting, timeDeltaMs: file.delta };
            }
        }
        return null;
    }

    async function inspect(avatarBase, fileName) {
        if (!avatarBase || !fileName || avatarBase !== path.basename(avatarBase) || fileName !== path.basename(fileName)) {
            return { ok: false, reason: 'file-name' };
        }

        const filePath = path.join(directories.chats, avatarBase, fileName);
        if (!LEGACY_CHAT_FILE_REGEXP.test(fileName)) {
            return { ok: false, reason: 'file-name' };
        }

        const card = await getCard(avatarBase);
        if (!card) {
            return { ok: false, reason: 'no-character' };
        }

        const identity = getFileIdentity(filePath);
        if (!identity) {
            return { ok: false, reason: 'missing' };
        }
        if (identity.size > MAX_CANDIDATE_FILE_BYTES) {
            return { ok: false, reason: 'message-count' };
        }

        let text;
        try {
            text = await fs.promises.readFile(filePath, 'utf8');
        } catch {
            return { ok: false, reason: 'missing' };
        }

        contextPromise ??= readGreetingContext(directories.root);
        const context = await contextPromise;
        const analysis = analyzeLegacyGreetingChat({ fileName, text, card, context });
        if (!analysis.ok) {
            return analysis;
        }

        const sibling = await findModernSibling(avatarBase, analysis, card, context);
        if (!sibling) {
            return { ok: false, reason: 'no-modern-sibling' };
        }

        return {
            ok: true,
            candidate: {
                avatarBase,
                fileName,
                filePath,
                identity,
                characterName: analysis.characterName,
                greetingIndex: analysis.greetingIndex,
                swipeCount: analysis.swipeCount,
                preview: analysis.preview,
                sendMs: analysis.sendMs,
                isCardChat: card.chat === fileName.replace(/\.jsonl$/i, ''),
                modern: {
                    fileName: sibling.fileName,
                    filePath: sibling.filePath,
                    identity: sibling.identity,
                    messageCount: sibling.messageCount,
                    startsWithSameGreeting: sibling.startsWithSameGreeting,
                    timeDeltaMs: sibling.timeDeltaMs,
                },
            },
        };
    }

    return { inspect };
}

/**
 * Scans the character chat folders for greeting-only duplicates. Read-only.
 * @param {import('./users.js').UserDirectoryList} directories User directories.
 * @param {object} [options] Options.
 * @param {(pngPath: string) => Promise<GreetingCard | null>} [options.readCard] Card reader, replaceable for tests.
 * @param {number} [options.maxDirectories] Character chat folders looked at before the scan stops.
 * @param {number} [options.maxFiles] Legacy-named chat files inspected before the scan stops.
 * @param {number} [options.timeoutMs] Time budget.
 * @param {() => number} [options.now] Clock, for tests.
 * @returns {Promise<{ candidates: DuplicateGreetingCandidate[], stats: { directories: number, legacyFiles: number }, truncated: boolean }>} Candidates and scan statistics.
 */
export async function findDuplicateGreetingChats(directories, options = {}) {
    const { readCard, maxDirectories = 5000, maxFiles = 20_000, timeoutMs = 30_000, now = Date.now } = options;
    const startedAt = now();
    const inspector = createDuplicateGreetingInspector(directories, { readCard });
    /** @type {DuplicateGreetingCandidate[]} */
    const candidates = [];
    const stats = { directories: 0, legacyFiles: 0 };
    let truncated = false;

    const folders = await fs.promises.readdir(directories.chats, { withFileTypes: true }).catch(() => []);
    scan: for (const folder of folders) {
        // A symbolic link to a directory is not a directory here, so it is never followed.
        if (!folder.isDirectory()) {
            continue;
        }
        if (stats.directories >= maxDirectories || now() - startedAt > timeoutMs) {
            truncated = true;
            break;
        }
        stats.directories++;

        const files = await fs.promises.readdir(path.join(directories.chats, folder.name), { withFileTypes: true }).catch(() => []);
        const hasModernFile = files.some(file => file.isFile() && MODERN_CHAT_FILE_REGEXP.test(file.name));
        if (!hasModernFile) {
            continue;
        }
        for (const file of files) {
            if (!file.isFile() || !LEGACY_CHAT_FILE_REGEXP.test(file.name)) {
                continue;
            }
            if (stats.legacyFiles >= maxFiles || now() - startedAt > timeoutMs) {
                truncated = true;
                break scan;
            }
            stats.legacyFiles++;

            const result = await inspector.inspect(folder.name, file.name);
            if (result.ok) {
                candidates.push(result.candidate);
            }
        }
    }

    candidates.sort((a, b) => a.avatarBase.localeCompare(b.avatarBase) || a.sendMs - b.sendMs);
    return { candidates, stats, truncated };
}

function pad(value, length = 2) {
    return String(value).padStart(length, '0');
}

/**
 * @param {Date} date Date.
 * @returns {string} `YYYYMMDD-HHMMSS` in local time, the stamp style the backup files use.
 */
function formatQuarantineStamp(date) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Creates `backups/quarantine-<stamp>[-n]` as a new directory.
 * @param {string} backupsDirectory The user's backups directory.
 * @param {Date} date Creation time.
 * @returns {Promise<string>} Path of the created directory.
 */
async function createQuarantineDirectory(backupsDirectory, date) {
    await fs.promises.mkdir(backupsDirectory, { recursive: true });
    for (let attempt = 0; attempt < 100; attempt++) {
        const directory = path.join(backupsDirectory, `quarantine-${formatQuarantineStamp(date)}${attempt ? `-${attempt + 1}` : ''}`);
        try {
            await fs.promises.mkdir(directory);
            return directory;
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }
        }
    }
    throw new Error('Could not create a quarantine directory.');
}

/**
 * Moves a file to a path that must not exist yet. A same-volume rename is atomic; across volumes the file is copied
 * exclusively, size-checked and only then removed from the source.
 * @param {string} source Source file.
 * @param {string} destination Destination path.
 * @returns {Promise<void>}
 */
async function moveFileWithoutOverwrite(source, destination) {
    if (await fs.promises.lstat(destination).then(() => true, () => false)) {
        throw Object.assign(new Error('Destination already exists.'), { code: 'EEXIST' });
    }

    try {
        await fs.promises.rename(source, destination);
    } catch (error) {
        if (error?.code !== 'EXDEV') {
            throw error;
        }
        const expectedSize = (await fs.promises.lstat(source)).size;
        await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
        if ((await fs.promises.lstat(destination)).size !== expectedSize) {
            await fs.promises.unlink(destination);
            throw new Error('Copy size mismatch while moving to quarantine.');
        }
        await fs.promises.unlink(source);
    }
}

/**
 * Removes the directories this call created in the quarantine when nothing ended up in them. `rmdir` fails on a
 * directory that has content, so a directory holding a moved file is never touched.
 * @param {string} quarantineDirectory Quarantine directory of this call.
 * @param {Set<string>} avatarDirectories Per-avatar directories created below it.
 * @returns {Promise<void>}
 */
async function removeEmptyQuarantineDirectories(quarantineDirectory, avatarDirectories) {
    for (const directory of [...avatarDirectories, path.join(quarantineDirectory, 'chats'), quarantineDirectory]) {
        await fs.promises.rmdir(directory).catch(() => {});
    }
}

function toRelativePosix(root, target) {
    return path.relative(root, target).split(path.sep).join('/');
}

/**
 * Moves the reported greeting-only duplicates to `backups/quarantine-<time>/chats/<avatar>/`. Every file is validated again
 * at this moment (same file as reported, rule still satisfied, card does not point at it) and anything that fails is skipped.
 * Nothing is deleted. A card that still points at a file is not repointed here; the caller must do that first.
 * @param {import('./users.js').UserDirectoryList} directories User directories.
 * @param {{ hash: string, filePath: string, identity: import('./file-identity.js').FileIdentity }[]} entries Reported files to move.
 * @param {object} [options] Options.
 * @param {(pngPath: string) => Promise<GreetingCard | null>} [options.readCard] Card reader, replaceable for tests.
 * @param {() => Date} [options.now] Clock, for tests.
 * @returns {Promise<{ quarantine: string | null, moved: { hash: string, avatar: string, file: string, size: number, from: string, to: string }[], skipped: { hash: string, reason: string, file?: string }[], manifestError?: string }>} Per-file outcome.
 */
export async function moveDuplicateGreetingChatsToQuarantine(directories, entries, options = {}) {
    const { readCard, now = () => new Date() } = options;
    const inspector = createDuplicateGreetingInspector(directories, { readCard });
    /** @type {string | null} */
    let quarantineDirectory = null;
    const avatarDirectories = new Set();
    const moved = [];
    const skipped = [];
    const manifestItems = [];

    for (const entry of entries) {
        const file = path.basename(entry.filePath);
        const segments = path.relative(directories.chats, entry.filePath).split(path.sep);
        if (!isPathUnderParent(directories.chats, entry.filePath) || segments.length !== 2 || segments.some(segment => !segment || segment === '..')) {
            skipped.push({ hash: entry.hash, reason: 'outside', file });
            continue;
        }

        const [avatarBase, fileName] = segments;
        if (!matchesFileIdentity(entry.filePath, entry.identity)) {
            skipped.push({ hash: entry.hash, reason: getFileIdentity(entry.filePath) ? 'changed' : 'missing', file });
            continue;
        }

        const verdict = await inspector.inspect(avatarBase, fileName);
        if (!verdict.ok) {
            skipped.push({ hash: entry.hash, reason: verdict.reason, file });
            continue;
        }
        if (verdict.candidate.isCardChat) {
            skipped.push({ hash: entry.hash, reason: 'card-chat', file });
            continue;
        }

        try {
            quarantineDirectory ??= await createQuarantineDirectory(directories.backups, now());
            const targetDirectory = path.join(quarantineDirectory, 'chats', avatarBase);
            await fs.promises.mkdir(targetDirectory, { recursive: true });
            avatarDirectories.add(targetDirectory);
            const destination = path.join(targetDirectory, fileName);

            // Last look right before the move: nothing wrote to the file since it was validated.
            if (!matchesFileIdentity(entry.filePath, entry.identity)) {
                skipped.push({ hash: entry.hash, reason: 'changed', file });
                continue;
            }
            await moveFileWithoutOverwrite(entry.filePath, destination);

            const record = {
                hash: entry.hash,
                avatar: `${avatarBase}.png`,
                file: fileName,
                size: entry.identity.size,
                from: toRelativePosix(directories.root, entry.filePath),
                to: toRelativePosix(directories.root, destination),
            };
            moved.push(record);
            manifestItems.push({ ...record, modern: verdict.candidate.modern.fileName, mtimeMs: entry.identity.mtimeMs });
        } catch (error) {
            skipped.push({ hash: entry.hash, reason: 'failed', file });
            console.error('[Data Maid] Could not move a duplicate greeting chat to quarantine:', error?.message ?? error);
        }
    }

    /** @type {string | undefined} */
    let manifestError;
    if (quarantineDirectory && moved.length === 0) {
        await removeEmptyQuarantineDirectories(quarantineDirectory, avatarDirectories);
    }
    if (quarantineDirectory && manifestItems.length > 0) {
        try {
            const manifest = {
                version: 1,
                createdAt: now().toISOString(),
                reason: 'duplicate-greeting-only-chats',
                restore: 'Move a file back from "to" to "from" (both relative to the user data directory) to undo.',
                items: manifestItems.map(({ hash: _hash, ...item }) => item),
            };
            await fs.promises.writeFile(path.join(quarantineDirectory, 'manifest.json'), JSON.stringify(manifest, null, 4), { encoding: 'utf8', flag: 'wx' });
        } catch (error) {
            manifestError = String(error?.message ?? error);
        }
    }

    return {
        quarantine: quarantineDirectory && moved.length > 0 ? toRelativePosix(directories.root, quarantineDirectory) : null,
        moved,
        skipped,
        ...(manifestError ? { manifestError } : {}),
    };
}

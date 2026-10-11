import fs from 'node:fs';
import path from 'node:path';
import { isPathUnderParent } from './util.js';

/**
 * User directory keys that are reported, in display order. Keys are the names used by `UserDirectoryList`.
 * `user` and `thumbnails` contain other listed directories (`userImages`, `files`, `comfyWorkflows`, `thumbnails*`);
 * they are reported without those, so every byte is counted once.
 */
export const USAGE_DIRECTORY_KEYS = Object.freeze([
    'characters', 'chats', 'groupChats', 'groups', 'worlds',
    'userImages', 'files', 'comfyWorkflows', 'user',
    'backgrounds', 'avatars',
    'thumbnailsAvatar', 'thumbnailsBg', 'thumbnailsPersona', 'thumbnails',
    'backups', 'extensions', 'assets', 'vectors',
    'novelAI_Settings', 'koboldAI_Settings', 'openAI_Settings', 'textGen_Settings',
    'themes', 'movingUI', 'instruct', 'context', 'quickreplies', 'sysprompt', 'reasoning',
]);

export const DEFAULT_USAGE_LIMITS = Object.freeze({
    /** Entries (files, directories, links) looked at in total before the scan stops. */
    maxEntries: 300_000,
    /** Wall-clock budget of the whole scan. */
    timeoutMs: 15_000,
});

const STAT_BATCH_SIZE = 64;

/**
 * @typedef {object} UsageEntry
 * @property {string} key Directory key, `other` for everything not listed in {@link USAGE_DIRECTORY_KEYS}.
 * @property {number} bytes Total size of the regular files found.
 * @property {number} files Number of regular files found.
 * @property {number} [symlinks] Symbolic links that were skipped (never followed, never counted).
 * @property {boolean} [missing] The directory does not exist.
 * @property {boolean} [truncated] The scan hit the entry or time limit; the numbers are lower bounds.
 */

/**
 * Shared entry and time budget of one scan.
 * @param {{ maxEntries: number, timeoutMs: number }} limits Scan limits.
 * @param {() => number} now Clock.
 */
function createBudget(limits, now) {
    const startedAt = now();
    let visited = 0;
    let exhausted = false;

    return {
        startedAt,
        /** Counts one entry; returns true when the budget is used up and the scan must stop. */
        tick() {
            visited++;
            if (exhausted) {
                return true;
            }
            if (visited > limits.maxEntries || (visited % 256 === 0 && now() - startedAt > limits.timeoutMs)) {
                exhausted = true;
            }
            return exhausted;
        },
        isExhausted() {
            if (!exhausted && now() - startedAt > limits.timeoutMs) {
                exhausted = true;
            }
            return exhausted;
        },
    };
}

/**
 * Adds up the regular files below a directory. Symbolic links are neither followed nor counted.
 * @param {string} directory Directory to walk.
 * @param {Set<string>} skipPaths Sub-directories counted somewhere else.
 * @param {ReturnType<typeof createBudget>} budget Shared budget.
 * @param {UsageEntry} entry Entry to accumulate into.
 * @returns {Promise<void>}
 */
async function walkDirectory(directory, skipPaths, budget, entry) {
    const pending = [directory];

    while (pending.length > 0) {
        if (budget.isExhausted()) {
            entry.truncated = true;
            return;
        }

        const current = /** @type {string} */ (pending.pop());
        let dirents;
        try {
            dirents = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        const filePaths = [];
        for (const dirent of dirents) {
            if (budget.tick()) {
                entry.truncated = true;
                return;
            }

            const fullPath = path.join(current, dirent.name);
            if (dirent.isSymbolicLink()) {
                entry.symlinks = (entry.symlinks || 0) + 1;
            } else if (dirent.isDirectory()) {
                if (!skipPaths.has(fullPath)) {
                    pending.push(fullPath);
                }
            } else if (dirent.isFile()) {
                filePaths.push(fullPath);
            }
        }

        for (let index = 0; index < filePaths.length; index += STAT_BATCH_SIZE) {
            const stats = await Promise.all(filePaths.slice(index, index + STAT_BATCH_SIZE).map(filePath => fs.promises.lstat(filePath).catch(() => null)));
            for (const stat of stats) {
                if (stat?.isFile()) {
                    entry.bytes += stat.size;
                    entry.files++;
                }
            }
        }
    }
}

/**
 * Measures one directory. A directory that is itself a symbolic link is reported empty rather than followed.
 * @param {string} key Entry key.
 * @param {string} directory Directory path.
 * @param {Set<string>} skipPaths Sub-directories counted somewhere else.
 * @param {ReturnType<typeof createBudget>} budget Shared budget.
 * @returns {Promise<UsageEntry>} Usage of the directory.
 */
async function measureDirectory(key, directory, skipPaths, budget) {
    /** @type {UsageEntry} */
    const entry = { key, bytes: 0, files: 0 };
    let stat;
    try {
        stat = await fs.promises.lstat(directory);
    } catch {
        entry.missing = true;
        return entry;
    }

    if (stat.isSymbolicLink()) {
        entry.symlinks = 1;
        return entry;
    }
    if (!stat.isDirectory()) {
        entry.missing = true;
        return entry;
    }

    await walkDirectory(directory, skipPaths, budget, entry);
    return entry;
}

/**
 * Reports how much space each user directory takes: only `readdir` and `lstat`, no file is opened or followed through a link.
 * @param {import('./users.js').UserDirectoryList} directories User directories.
 * @param {object} [options] Options.
 * @param {number} [options.maxEntries] Entry limit (see {@link DEFAULT_USAGE_LIMITS}).
 * @param {number} [options.timeoutMs] Time limit in milliseconds.
 * @param {() => number} [options.now] Clock, for tests.
 * @returns {Promise<{ entries: UsageEntry[], totalBytes: number, totalFiles: number, truncated: boolean, durationMs: number, disk: { freeBytes: number, totalBytes: number } | null, limits: { maxEntries: number, timeoutMs: number } }>} Usage report.
 */
export async function collectStorageUsage(directories, options = {}) {
    const limits = {
        maxEntries: options.maxEntries ?? DEFAULT_USAGE_LIMITS.maxEntries,
        timeoutMs: options.timeoutMs ?? DEFAULT_USAGE_LIMITS.timeoutMs,
    };
    const now = options.now ?? Date.now;
    const budget = createBudget(limits, now);
    const root = directories.root;

    /** @type {Map<string, string>} */
    const listed = new Map();
    for (const key of USAGE_DIRECTORY_KEYS) {
        const directory = directories[key];
        if (typeof directory === 'string' && directory && path.resolve(directory) !== path.resolve(root) && isPathUnderParent(root, directory)) {
            listed.set(key, path.resolve(directory));
        }
    }

    /** @type {UsageEntry[]} */
    const entries = [];
    for (const [key, directory] of listed) {
        const nested = new Set([...listed.values()].filter(other => other !== directory && isPathUnderParent(directory, other)));
        entries.push(await measureDirectory(key, directory, nested, budget));
    }

    // Everything directly under the user root that is not a listed directory (or the parent of one): settings.json, secrets.json, ...
    const listedPaths = [...listed.values()];
    /** @type {UsageEntry} */
    const other = { key: 'other', bytes: 0, files: 0 };
    try {
        const rootEntries = await fs.promises.readdir(root, { withFileTypes: true });
        for (const dirent of rootEntries) {
            const fullPath = path.resolve(root, dirent.name);
            if (listedPaths.some(listedPath => listedPath === fullPath || isPathUnderParent(fullPath, listedPath))) {
                continue;
            }
            if (budget.tick()) {
                other.truncated = true;
                break;
            }
            if (dirent.isSymbolicLink()) {
                other.symlinks = (other.symlinks || 0) + 1;
            } else if (dirent.isDirectory()) {
                await walkDirectory(fullPath, new Set(), budget, other);
            } else if (dirent.isFile()) {
                const stat = await fs.promises.lstat(fullPath).catch(() => null);
                if (stat?.isFile()) {
                    other.bytes += stat.size;
                    other.files++;
                }
            }
        }
    } catch {
        // An unreadable root leaves the entry empty.
    }
    entries.push(other);

    /** @type {{ freeBytes: number, totalBytes: number } | null} */
    let disk = null;
    try {
        const stats = await fs.promises.statfs(root);
        disk = { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) };
    } catch {
        // statfs is unavailable on this platform or path.
    }

    return {
        entries,
        totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        totalFiles: entries.reduce((sum, entry) => sum + entry.files, 0),
        truncated: entries.some(entry => entry.truncated),
        durationMs: now() - budget.startedAt,
        disk,
        limits,
    };
}

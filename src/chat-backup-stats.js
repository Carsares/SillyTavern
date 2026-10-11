import fs from 'node:fs';
import path from 'node:path';

/**
 * Statistics over chat backup files (`chat_<name>_<YYYYMMDD-HHMMSS>.jsonl`). Only `readdir` and `lstat`; no backup is opened.
 */

const CHAT_BACKUP_NAME_REGEXP = /^chat_(.+)_(\d{8}-\d{6})\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_BACKUP_FILES_SCANNED = 100_000;
export const MAX_OLDER_THAN_NAMES = 2000;
export const MAX_OLDER_THAN_DAYS = 3650;

/**
 * @typedef {object} ChatBackupSeries
 * @property {string} key Series name: the part between `chat_` and the timestamp.
 * @property {number} files Number of backups.
 * @property {number} bytes Total size.
 * @property {number} oldest Oldest modification time (ms).
 * @property {number} newest Newest modification time (ms).
 */

/**
 * Reads the `olderThanDays` value of a stats request.
 * @param {any} value Request value.
 * @returns {number | null} Whole days from 1 to {@link MAX_OLDER_THAN_DAYS}, or null if absent or not acceptable.
 */
export function parseOlderThanDays(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_OLDER_THAN_DAYS ? value : null;
}

/**
 * @param {string} backupsDirectory The user's backups directory.
 * @param {object} [options] Options.
 * @param {number | null} [options.olderThanDays] When set, also lists the backups last modified more than this many days ago.
 * @param {number} [options.now] Current time (ms), for tests.
 * @returns {Promise<{
 *   total: { files: number, bytes: number },
 *   series: ChatBackupSeries[],
 *   unrecognized: { files: number, bytes: number },
 *   truncated: boolean,
 *   olderThan: null | { days: number, cutoff: number, files: number, bytes: number, names: string[], namesTruncated: boolean },
 * }>} Statistics. `unrecognized` counts `chat_*.jsonl` files whose name does not follow the backup naming.
 */
export async function collectChatBackupStats(backupsDirectory, { olderThanDays = null, now = Date.now() } = {}) {
    // No backups directory yet means no backups
    const dirents = await fs.promises.readdir(backupsDirectory, { withFileTypes: true })
        .catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error));
    /** @type {Map<string, ChatBackupSeries>} */
    const series = new Map();
    const total = { files: 0, bytes: 0 };
    const unrecognized = { files: 0, bytes: 0 };
    const cutoff = olderThanDays ? now - olderThanDays * DAY_MS : null;
    const olderThan = olderThanDays ? { days: olderThanDays, cutoff: /** @type {number} */ (cutoff), files: 0, bytes: 0, names: /** @type {string[]} */ ([]), namesTruncated: false } : null;
    let scanned = 0;
    let truncated = false;

    for (const dirent of dirents) {
        if (!dirent.isFile() || !dirent.name.startsWith('chat_') || path.extname(dirent.name) !== '.jsonl') {
            continue;
        }
        if (scanned >= MAX_BACKUP_FILES_SCANNED) {
            truncated = true;
            break;
        }
        scanned++;

        let stat;
        try {
            stat = await fs.promises.lstat(path.join(backupsDirectory, dirent.name));
        } catch {
            continue;
        }
        if (!stat.isFile()) {
            continue;
        }

        total.files++;
        total.bytes += stat.size;

        const match = CHAT_BACKUP_NAME_REGEXP.exec(dirent.name);
        if (match) {
            const key = match[1];
            const entry = series.get(key) ?? { key, files: 0, bytes: 0, oldest: stat.mtimeMs, newest: stat.mtimeMs };
            entry.files++;
            entry.bytes += stat.size;
            entry.oldest = Math.min(entry.oldest, stat.mtimeMs);
            entry.newest = Math.max(entry.newest, stat.mtimeMs);
            series.set(key, entry);
        } else {
            unrecognized.files++;
            unrecognized.bytes += stat.size;
        }

        // Backups of an unrecognized name are never offered for the age-based delete.
        if (olderThan && match && stat.mtimeMs < olderThan.cutoff) {
            olderThan.files++;
            olderThan.bytes += stat.size;
            if (olderThan.names.length < MAX_OLDER_THAN_NAMES) {
                olderThan.names.push(dirent.name);
            } else {
                olderThan.namesTruncated = true;
            }
        }
    }

    return {
        total,
        series: [...series.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key)),
        unrecognized,
        truncated,
        olderThan,
    };
}

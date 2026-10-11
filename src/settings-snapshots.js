import fs from 'node:fs';
import path from 'node:path';

/**
 * Settings snapshot files in the user's backups directory: `settings_<handle>_<YYYYMMDD-HHMMSS>.json`.
 * Pure file helpers (no other project modules), so the endpoints and their tests share one validation.
 */

export const MAX_PRUNE_KEEP = 10_000;

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} handle User handle.
 * @returns {string} Prefix shared by all snapshot files of the user.
 */
export function getSnapshotPrefix(handle) {
    return `settings_${handle}_`;
}

/**
 * Whether a name is exactly a snapshot this server writes for the user. A bare prefix check is not enough for deletion:
 * a handle that is a prefix of another (`alice_` / `alice_2_`) would match the other user's files.
 * @param {string} handle User handle.
 * @param {any} name Candidate file name.
 * @returns {boolean} True for `settings_<handle>_<YYYYMMDD-HHMMSS>.json` and nothing else.
 */
export function isSnapshotName(handle, name) {
    return typeof name === 'string'
        && name === path.basename(name)
        && new RegExp(`^${escapeRegExp(getSnapshotPrefix(handle))}\\d{8}-\\d{6}\\.json$`).test(name);
}

/**
 * @typedef {object} SnapshotInfo
 * @property {string} name File name.
 * @property {number} size Size in bytes.
 * @property {number} date Change time (ms), the date `get-snapshots` reports.
 * @property {boolean} deletable Whether the name is a snapshot name this server writes.
 */

/**
 * Lists the regular files that look like the user's snapshots, newest first. A symbolic link is not listed.
 * The list is the one `get-snapshots` shows: every file with the user's prefix, newest by change time.
 * @param {string} backupsDirectory The user's backups directory.
 * @param {string} handle User handle.
 * @returns {Promise<SnapshotInfo[]>} Snapshots, newest first (ties by name, descending).
 */
export async function listSnapshots(backupsDirectory, handle) {
    const prefix = getSnapshotPrefix(handle);
    const dirents = await fs.promises.readdir(backupsDirectory, { withFileTypes: true });
    const snapshots = [];
    for (const dirent of dirents) {
        if (!dirent.isFile() || !dirent.name.startsWith(prefix)) {
            continue;
        }
        try {
            const stat = await fs.promises.lstat(path.join(backupsDirectory, dirent.name));
            if (stat.isFile()) {
                snapshots.push({ name: dirent.name, size: stat.size, date: stat.ctimeMs, deletable: isSnapshotName(handle, dirent.name) });
            }
        } catch {
            // The file disappeared while listing.
        }
    }
    return snapshots.sort((a, b) => b.date - a.date || b.name.localeCompare(a.name));
}

/**
 * Plans a prune: the deletable snapshots beyond the newest `keep`. The newest snapshot of all is never part of the plan.
 * @param {SnapshotInfo[]} snapshots Result of {@link listSnapshots}.
 * @param {number} keep How many of the newest deletable snapshots stay.
 * @returns {{ keep: SnapshotInfo[], remove: SnapshotInfo[] }} Snapshots that stay and snapshots that would be deleted.
 */
export function planSnapshotPrune(snapshots, keep) {
    const newest = snapshots[0]?.name;
    const deletable = snapshots.filter(snapshot => snapshot.deletable);
    const kept = deletable.slice(0, keep);
    const remove = deletable.slice(keep).filter(snapshot => snapshot.name !== newest);
    return { keep: kept, remove };
}

/**
 * Reads the `keep` value of a prune request.
 * @param {any} value Request value.
 * @returns {number | null} A whole number from 1 to {@link MAX_PRUNE_KEEP}, or null if the value is not acceptable.
 */
export function parseKeepCount(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_PRUNE_KEEP ? value : null;
}

/**
 * Deletes one snapshot file after checking it again: a valid snapshot name, a regular file (never a link), inside the
 * backups directory, and not the newest snapshot.
 * @param {string} backupsDirectory The user's backups directory.
 * @param {string} handle User handle.
 * @param {string} name Snapshot file name.
 * @returns {Promise<{ ok: true, size: number } | { ok: false, reason: 'invalid' | 'missing' | 'newest' | 'failed' }>} Outcome.
 */
export async function deleteSnapshotFile(backupsDirectory, handle, name) {
    if (!isSnapshotName(handle, name)) {
        return { ok: false, reason: 'invalid' };
    }

    const filePath = path.join(backupsDirectory, name);
    const relative = path.relative(backupsDirectory, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return { ok: false, reason: 'invalid' };
    }

    let stat;
    try {
        stat = await fs.promises.lstat(filePath);
    } catch {
        return { ok: false, reason: 'missing' };
    }
    if (!stat.isFile()) {
        return { ok: false, reason: 'invalid' };
    }

    const snapshots = await listSnapshots(backupsDirectory, handle);
    if (snapshots[0]?.name === name) {
        return { ok: false, reason: 'newest' };
    }

    try {
        await fs.promises.unlink(filePath);
        return { ok: true, size: stat.size };
    } catch (error) {
        return { ok: false, reason: error?.code === 'ENOENT' ? 'missing' : 'failed' };
    }
}

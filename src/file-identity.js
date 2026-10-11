import fs from 'node:fs';

/**
 * @typedef {object} FileIdentity
 * @property {number} dev - Device identifier.
 * @property {number} ino - File system inode identifier.
 * @property {number} size - File size in bytes.
 * @property {number} mtimeMs - Last modification time.
 * @property {number} ctimeMs - Last metadata change time.
 */

/**
 * Gets the stable file metadata used to ensure a cleanup token still refers to the scanned file.
 * Symbolic links are never followed: a link is not a regular file, so it has no identity.
 * @param {string} filePath Path to the file.
 * @returns {FileIdentity|null} File identity, or null if the path is no longer a regular file.
 */
export function getFileIdentity(filePath) {
    try {
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile()) {
            return null;
        }

        return {
            dev: stat.dev,
            ino: stat.ino,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ctimeMs: stat.ctimeMs,
        };
    } catch {
        return null;
    }
}

/**
 * Checks whether a path still contains the file captured by a cleanup token.
 * @param {string} filePath Path to the file.
 * @param {FileIdentity} expected Expected file identity.
 * @returns {boolean} Whether the current file matches the token snapshot.
 */
export function matchesFileIdentity(filePath, expected) {
    const current = getFileIdentity(filePath);
    return current !== null
        && !!expected
        && current.dev === expected.dev
        && current.ino === expected.ino
        && current.size === expected.size
        && current.mtimeMs === expected.mtimeMs
        && current.ctimeMs === expected.ctimeMs;
}

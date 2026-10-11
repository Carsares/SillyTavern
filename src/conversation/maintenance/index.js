import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, lstatSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { invariant, canonicalJson, BACKUP_MAX_BYTES } from '../../../public/shared/conversation/schemas/index.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const stripCredentials = value => {
    if (Array.isArray(value)) return value.map(stripCredentials);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|api_key|authorization|password|secret|accessToken|refreshToken|headers)$/i.test(key)).map(([key, item]) => [key, stripCredentials(item)]));
};

export function createMaintenance({ store, directory, retrieval, now = Date.now }) {
    const root = resolve(realpathSync(directory), 'attachments');
    const previews = new Map();
    const files = () => existsSync(root) ? readdirSync(root).filter(name => /^[a-f0-9-]{36}(\.partial)?$/.test(name)) : [];
    function referenced() { return new Set((store.listAttachments?.() ?? []).map(record => record.id)); }
    function candidates() {
        const refs = referenced();
        return files().filter(name => {
            const stat = lstatSync(resolve(root, name));
            return !stat.isSymbolicLink() && stat.isFile() && !refs.has(name.replace(/\.partial$/, '')) && now() - stat.mtimeMs >= 24 * 60 * 60 * 1000;
        }).map(name => ({ name, size: lstatSync(resolve(root, name)).size, modifiedAt: lstatSync(resolve(root, name)).mtimeMs }));
    }
    return {
        status() {
            const entries = files().map(name => ({ name, size: lstatSync(resolve(root, name)).size }));
            return { schemaVersion: 1, conversations: store.listConversations().length, attachments: store.listAttachments?.().length ?? 0, attachmentBytes: entries.reduce((sum, entry) => sum + entry.size, 0), orphanCandidates: candidates().length };
        },
        export({ includeCredentials = false } = {}) {
            invariant(!store.listConversations().some(conversation => conversation.activeTurnId), 'conversation-busy', 'Finish active generations before making a backup', 409);
            const data = store.exportData();
            const attachments = (store.listAttachments?.() ?? []).map(record => {
                invariant(/^[a-f0-9-]{36}$/.test(record.id), 'invalid-attachment', 'Invalid attachment identifier');
                const path = resolve(root, record.id);
                invariant(existsSync(path) && !lstatSync(path).isSymbolicLink(), 'attachment-missing', 'Cannot export a backup with missing attachments', 409);
                const bytes = readFileSync(path);
                invariant(hash(bytes) === record.sha256, 'attachment-corrupt', 'Attachment hash mismatch', 409);
                return { id: record.id, base64: bytes.toString('base64') };
            });
            const backup = { format: 'conversation-v1-backup', schemaVersion: 1, createdAt: new Date(now()).toISOString(), credentialsIncluded: includeCredentials, repository: includeCredentials ? data : stripCredentials(data), files: attachments };
            invariant(Buffer.byteLength(JSON.stringify({ schemaVersion: 1, backup })) <= BACKUP_MAX_BYTES, 'backup-size-limit', 'Backup exceeds the 256 MiB restore format limit; preserve the complete stopped data directory instead', 413);
            return backup;
        },
        async restore(backup) {
            invariant(backup?.format === 'conversation-v1-backup' && backup.schemaVersion === 1 && Array.isArray(backup.files), 'invalid-backup', 'Expected a conversation-v1 backup');
            invariant(store.listConversations().length === 0 && store.listResources().length === 0, 'restore-not-empty', 'Restore into an empty new workspace only', 409);
            store.validateBackup(backup.repository);
            const records = Object.values(backup.repository.attachments ?? {});
            const fileMap = new Map(backup.files.map(file => [file.id, file]));
            invariant(fileMap.size === backup.files.length && fileMap.size === records.length, 'invalid-backup', 'Attachment file set mismatch');
            const decoded = records.map(record => {
                invariant(/^[a-f0-9-]{36}$/.test(record.id) && record.path === record.id, 'invalid-backup', 'Unsafe attachment path');
                const file = fileMap.get(record.id);
                invariant(file && typeof file.base64 === 'string', 'attachment-missing', 'Backup attachment is missing');
                const bytes = Buffer.from(file.base64, 'base64');
                invariant(bytes.length === record.size && hash(bytes) === record.sha256, 'attachment-corrupt', 'Backup attachment failed validation');
                return { record, bytes };
            });
            mkdirSync(root, { recursive: true, mode: 0o700 });
            invariant(realpathSync(root) === root, 'unsafe-path', 'Attachment directory cannot be a symlink');
            for (const { record, bytes } of decoded) {
                const path = resolve(root, record.id);
                if (existsSync(path)) {
                    invariant(!lstatSync(path).isSymbolicLink() && hash(readFileSync(path)) === record.sha256, 'restore-file-exists', 'Restore would overwrite a different existing file', 409);
                    continue; // Resume an interrupted restore without rewriting verified bytes.
                }
                const temporary = `${path}.partial`;
                if (existsSync(temporary)) {
                    invariant(!lstatSync(temporary).isSymbolicLink() && hash(readFileSync(temporary)) === record.sha256, 'restore-file-exists', 'An incomplete restore file requires cleanup before retry', 409);
                    renameSync(temporary, path);
                    continue;
                }
                const fd = openSync(temporary, 'wx', 0o600);
                try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
                renameSync(temporary, path);
            }
            const directoryFd = openSync(root, 'r');
            try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
            const result = store.restoreData(backup.repository);
            return { ...result, credentialsIncluded: backup.credentialsIncluded, indexStatus: 'rebuild-required' };
        },
        async reindex(conversationId) {
            invariant(retrieval, 'retrieval-unavailable', 'Retrieval service unavailable', 422);
            const ids = conversationId ? [conversationId] : store.listConversations().map(conversation => conversation.id);
            for (const id of ids) await retrieval.rebuild(id);
            return { rebuilt: ids };
        },
        previewCleanup() {
            const entries = candidates();
            const token = randomUUID();
            previews.set(token, { entries, fingerprint: hash(canonicalJson(entries)), expiresAt: now() + 300000 });
            return { token, entries, bytes: entries.reduce((sum, entry) => sum + entry.size, 0), expiresInMs: 300000 };
        },
        cleanup({ token }) {
            const preview = previews.get(token);
            invariant(preview && now() < preview.expiresAt, 'cleanup-preview-required', 'Create a fresh cleanup preview', 409);
            invariant(!store.listConversations().some(conversation => conversation.activeTurnId), 'conversation-busy', 'Do not clean while a generation is active', 409);
            invariant(preview.fingerprint === hash(canonicalJson(candidates())), 'cleanup-conflict', 'Files changed after preview; preview again', 409);
            for (const entry of preview.entries) unlinkSync(resolve(root, entry.name));
            previews.delete(token);
            return { deleted: preview.entries.length, bytes: preview.entries.reduce((sum, entry) => sum + entry.size, 0) };
        },
    };
}

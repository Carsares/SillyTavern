import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, lstatSync, readFileSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { invariant, canonicalJson, BACKUP_MAX_BYTES } from '../../../public/shared/conversation/schemas/index.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const stripCredentials = value => {
    if (Array.isArray(value)) return value.map(stripCredentials);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|api_key|authorization|password|secret|accessToken|refreshToken|headers|proxy)$/i.test(key)).map(([key, item]) => [key, stripCredentials(item)]));
};

export function createMaintenance({ store, directory, retrieval, now = Date.now }) {
    const root = resolve(realpathSync(directory), 'attachments');
    const previews = new Map();
    const checkRoot = () => invariant(!existsSync(root) || realpathSync(root) === root, 'unsafe-path', 'Attachment directory cannot be a symlink');
    const files = () => { checkRoot(); return existsSync(root) ? readdirSync(root).filter(name => /^[a-f0-9-]{36}(\.partial)?$/.test(name)) : []; };
    function referenced() {
        const unused = new Set((store.listUnreferencedAttachments?.() ?? []).map(record => record.id));
        return new Set((store.listAttachments?.() ?? []).filter(record => !unused.has(record.id)).map(record => record.path));
    }
    function candidates() {
        const refs = referenced();
        const registered = new Map((store.listAttachments?.() ?? []).map(record => [record.path, record]));
        return files().filter(name => {
            const stat = lstatSync(resolve(root, name));
            return !stat.isSymbolicLink() && stat.isFile() && !refs.has(name.replace(/\.partial$/, '')) && now() - stat.mtimeMs >= 24 * 60 * 60 * 1000
                && (!registered.has(name) || now() - new Date(registered.get(name).createdAt).getTime() >= 24 * 60 * 60 * 1000);
        }).map(name => ({ name, size: lstatSync(resolve(root, name)).size, modifiedAt: lstatSync(resolve(root, name)).mtimeMs, ...(registered.has(name) ? { attachmentId: registered.get(name).id } : {}) }));
    }
    return {
        status() {
            const entries = files().map(name => ({ name, size: lstatSync(resolve(root, name)).size }));
            const traces = store.listTraces?.() ?? [];
            const retained = new Set(['id', 'conversationId', 'turnId', 'memberRunId', 'kind', 'category', 'parentTraceId', 'status', 'createdAt', 'finishedAt', 'usage', 'detailsPrunedAt']);
            const traceBytes = traces.reduce((sum, trace) => sum + Buffer.byteLength(JSON.stringify(trace)), 0);
            const detailBytes = traces.reduce((sum, trace) => {
                if (trace.detailsPrunedAt) return sum;
                const details = Object.fromEntries(Object.entries(trace).filter(([key]) => !retained.has(key)));
                return sum + (Object.keys(details).length ? Buffer.byteLength(JSON.stringify(details)) : 0);
            }, 0);
            return { schemaVersion: 1, conversations: store.listConversations().length, attachments: store.listAttachments?.().length ?? 0, attachmentBytes: entries.reduce((sum, entry) => sum + entry.size, 0), orphanCandidates: candidates().length, traceCount: traces.length, traceBytes, detailBytes };
        },
        export() {
            checkRoot();
            const conversations = store.listConversations().map(c => {
                const view = store.getConversation(c.id);
                return { id: c.id, title: c.title, messages: view.messages.filter(m => !m.userHidden), summaries: view.summaries.filter(b => b.status === 'valid'), memories: view.memories.filter(b => b.status === 'valid') };
            });
            const ids = new Set();
            const collect = value => {
                if (Array.isArray(value)) return value.forEach(collect);
                if (!value || typeof value !== 'object') return;
                if (typeof value.attachmentId === 'string') ids.add(value.attachmentId);
                for (const ref of value.attachmentRefs ?? []) {
                    if (typeof ref === 'string') ids.add(ref);
                    else if (ref && typeof ref.id === 'string') ids.add(ref.id);
                }
                Object.values(value).forEach(collect);
            };
            collect(conversations);
            const attachments = [...ids].map(id => {
                const record = store.getAttachment(id);
                invariant(/^[a-f0-9-]{36}$/.test(record.id) && record.path === record.id, 'invalid-attachment', 'Unsafe attachment path');
                const path = resolve(root, record.path);
                invariant(existsSync(path) && !lstatSync(path).isSymbolicLink(), 'attachment-missing', 'Export attachment is missing', 409);
                const bytes = readFileSync(path);
                invariant(bytes.length === record.size && hash(bytes) === record.sha256, 'attachment-corrupt', 'Export attachment is corrupt', 409);
                const metadata = { ...record }; delete metadata.path;
                return { ...metadata, base64: bytes.toString('base64') };
            });
            return { format: 'conversation-v1-export', schemaVersion: 1, createdAt: new Date(now()).toISOString(), conversations, attachments };
        },
        backup({ includeCredentials = false } = {}) {
            checkRoot();
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
        previewCleanup({ traceRetentionMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
            invariant(Number.isSafeInteger(traceRetentionMs) && traceRetentionMs >= 0, 'invalid-retention', 'Trace retention must be nonnegative milliseconds');
            const all = store.listTraces?.() ?? [];
            const byId = new Map(all.map(trace => [trace.id, trace]));
            const conversations = new Map(store.listConversations().map(conversation => [conversation.id, conversation]));
            const traces = all.filter(trace => {
                if (trace.detailsPrunedAt || !trace.turnId && trace.status === 'running') return false;
                const turn = trace.turnId ? store.getTurn(trace.turnId) : undefined;
                if (turn && !['completed', 'failed', 'stopped', 'interrupted'].includes(turn.status)) return false;
                // Request and auxiliary usage records were once saved untimed. Prefer times no earlier than the record
                // (parent finish, turn completion); only then times no later than it (parent start, conversation creation).
                const parent = byId.get(trace.parentTraceId) ?? {};
                const at = trace.finishedAt ?? trace.createdAt ?? parent.finishedAt ?? turn?.completedAt ?? parent.createdAt ?? conversations.get(trace.conversationId)?.createdAt;
                return now() - new Date(at).getTime() >= traceRetentionMs;
            }).map(trace => ({ id: trace.id, fingerprint: canonicalJson(trace) }));
            const entries = candidates();
            const token = randomUUID();
            previews.set(token, { entries, traces, fingerprint: hash(canonicalJson(entries)), expiresAt: now() + 300000 });
            return { token, entries, traces: traces.map(({ id }) => ({ id })), bytes: entries.reduce((sum, entry) => sum + entry.size, 0), expiresInMs: 300000 };
        },
        cleanup({ token }) {
            const preview = previews.get(token);
            invariant(preview && now() < preview.expiresAt, 'cleanup-preview-required', 'Create a fresh cleanup preview', 409);
            invariant(!store.listConversations().some(conversation => conversation.activeTurnId), 'conversation-busy', 'Do not clean while a generation is active', 409);
            invariant(preview.fingerprint === hash(canonicalJson(candidates())), 'cleanup-conflict', 'Files changed after preview; preview again', 409);
            if (preview.traces.length) store.pruneTraces(preview.traces);
            for (const entry of preview.entries) {
                if (entry.attachmentId) store.deleteAttachment(entry.attachmentId);
                unlinkSync(resolve(root, entry.name));
            }
            previews.delete(token);
            return { deleted: preview.entries.length, tracesPruned: preview.traces.length, bytes: preview.entries.reduce((sum, entry) => sum + entry.size, 0) };
        },
    };
}

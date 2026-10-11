import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { invariant, requireString } from '../../../public/shared/conversation/schemas/index.js';

export function createAttachmentService({ directory, store, maxBytes = 8 * 1024 * 1024 }) {
    const root = resolve(directory, 'attachments');
    function pathFor(id) {
        invariant(/^[a-f0-9-]{36}$/.test(id), 'invalid-attachment', 'Invalid attachment ID');
        return resolve(root, id);
    }
    return {
        async save({ name, mime = 'application/octet-stream', base64 }) {
            requireString(name, 'name', 256); requireString(base64, 'base64', Math.ceil(maxBytes * 4 / 3) + 4);
            invariant(/^[\w.+-]+\/[\w.+-]+$/.test(mime), 'invalid-media', 'Invalid media type');
            invariant(/^[A-Za-z0-9+/]*={0,2}$/.test(base64) && base64.length % 4 === 0, 'invalid-media', 'Invalid base64 payload');
            const bytes = Buffer.from(base64, 'base64');
            invariant(bytes.length > 0 && bytes.length <= maxBytes, 'attachment-limit', 'Attachment is empty or too large', 413);
            mkdirSync(root, { recursive: true, mode: 0o700 });
            invariant(realpathSync(root) === root, 'unsafe-path', 'Attachment directory must not be a symlink');
            const id = randomUUID();
            const finalPath = pathFor(id);
            const temporary = `${finalPath}.partial`;
            const fd = openSync(temporary, 'wx', 0o600);
            try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
            renameSync(temporary, finalPath);
            const directoryFd = openSync(dirname(finalPath), 'r');
            try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
            // A failed database commit deliberately leaves an orphan for delayed cleanup.
            return store.saveAttachment({ id, name, mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), path: id, createdAt: new Date().toISOString() });
        },
        read(id) {
            const record = store.getAttachment(id);
            const path = pathFor(id);
            invariant(!lstatSync(path).isSymbolicLink() && realpathSync(path).startsWith(root + sep), 'unsafe-path', 'Attachment resolves outside its directory');
            const bytes = readFileSync(path);
            invariant(bytes.length === record.size && createHash('sha256').update(bytes).digest('hex') === record.sha256, 'attachment-corrupt', 'Attachment checksum does not match', 409);
            return { ...record, bytes };
        },
    };
}

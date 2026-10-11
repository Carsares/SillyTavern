import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { temporaryDirectory } from '../../harness/index.mjs';
import { createMaintenance } from '../../../../src/conversation/maintenance/index.js';

test('interrupted restore resumes only identical attachment bytes', async t => {
    const directory = temporaryDirectory(t), id = randomUUID();
    const bytes = Buffer.from('recovered attachment');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const root = join(directory, 'attachments'); mkdirSync(root);
    const file = join(root, id); writeFileSync(file, bytes);
    let restored = 0;
    const store = { listConversations: () => [], listResources: () => [], validateBackup() {}, restoreData() { restored++; return { restored: true }; } };
    const service = createMaintenance({ store, directory });
    const backup = { format: 'conversation-v1-backup', schemaVersion: 1, repository: { attachments: { [id]: { id, path: id, sha256, size: bytes.length } } }, files: [{ id, base64: bytes.toString('base64') }] };
    await service.restore(backup);
    assert.equal(restored, 1); assert.deepEqual(readFileSync(file), bytes);
    writeFileSync(file, 'unrelated');
    await assert.rejects(service.restore(backup), error => error.code === 'restore-file-exists');
    assert.equal(restored, 1); assert.equal(readFileSync(file, 'utf8'), 'unrelated');
});

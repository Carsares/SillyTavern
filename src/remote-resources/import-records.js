import fs from 'node:fs';
import path from 'node:path';

import { sync as writeFileAtomicSync } from 'write-file-atomic';

import { uuidv4 } from '../util.js';

const RECORD_DIR = 'remote-resources';
const RECORD_FILE = 'imports.json';
const MAX_RECORDS = 500;

export function readRemoteImportRecords(directories) {
    const filePath = getRecordPath(directories);
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function addRemoteImportRecord(directories, record) {
    const records = readRemoteImportRecords(directories);
    const nextRecord = {
        id: uuidv4(),
        providerId: String(record.providerId || ''),
        providerName: String(record.providerName || ''),
        remoteId: String(record.remoteId || ''),
        resourceType: String(record.resourceType || ''),
        title: String(record.title || ''),
        sourceUrl: String(record.sourceUrl || ''),
        localType: String(record.localType || ''),
        localId: String(record.localId || ''),
        action: String(record.action || 'import'),
        metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
        importedAt: new Date().toISOString(),
    };

    const nextRecords = [nextRecord, ...records].slice(0, MAX_RECORDS);
    writeRemoteImportRecords(directories, nextRecords);
    return nextRecord;
}

export function deleteRemoteImportRecord(directories, id) {
    const records = readRemoteImportRecords(directories);
    const nextRecords = records.filter(record => record.id !== id);
    writeRemoteImportRecords(directories, nextRecords);
}

function writeRemoteImportRecords(directories, records) {
    const filePath = getRecordPath(directories);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileAtomicSync(filePath, JSON.stringify(records, null, 4), 'utf8');
}

function getRecordPath(directories) {
    return path.join(directories.root, RECORD_DIR, RECORD_FILE);
}

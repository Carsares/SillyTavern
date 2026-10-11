import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let stats;
let statsHandler;
const tempDirectories = [];

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    stats = await import('../src/chat-backup-stats.js');
    const { router } = await import('../src/endpoints/backups.js');
    statsHandler = router.stack.find(layer => layer.route?.path === '/chat/stats').route.stack[0].handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createBackups() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-backup-stats-'));
    tempDirectories.push(directory);
    return directory;
}

/** Writes a backup file with a modification time `ageDays` before NOW. */
function writeBackup(directory, name, size, ageDays) {
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, Buffer.alloc(size, 1));
    const time = new Date(NOW - ageDays * DAY_MS);
    fs.utimesSync(filePath, time, time);
}

describe('chat backup stats', () => {
    test('counts files and bytes per series with the oldest and newest time, and separates look-alike series', async () => {
        const directory = createBackups();
        writeBackup(directory, 'chat_alice_20260101-000000.jsonl', 100, 40);
        writeBackup(directory, 'chat_alice_20260102-000000.jsonl', 200, 10);
        writeBackup(directory, 'chat_alice_2_20260101-000000.jsonl', 50, 5);
        writeBackup(directory, 'chat_bob_20260101-000000.jsonl', 1000, 1);

        const result = await stats.collectChatBackupStats(directory, { now: NOW });

        expect(result.total).toEqual({ files: 4, bytes: 1350 });
        expect(result.series.map(series => series.key)).toEqual(['bob', 'alice', 'alice_2']);
        const alice = result.series.find(series => series.key === 'alice');
        expect(alice).toMatchObject({ files: 2, bytes: 300, oldest: NOW - 40 * DAY_MS, newest: NOW - 10 * DAY_MS });
        expect(result.series.find(series => series.key === 'alice_2')).toMatchObject({ files: 1, bytes: 50 });
        expect(result.olderThan).toBeNull();
        expect(result.truncated).toBe(false);
    });

    test('ignores directories, other file types and other prefixes, and counts misnamed chat files separately', async () => {
        const directory = createBackups();
        writeBackup(directory, 'chat_alice_20260101-000000.jsonl', 10, 1);
        writeBackup(directory, 'chat_manual copy.jsonl', 20, 1);
        writeBackup(directory, 'settings_alice_20260101-000000.json', 400, 1);
        writeBackup(directory, 'chat_alice_20260101-000000.txt', 400, 1);
        fs.mkdirSync(path.join(directory, 'chat_folder.jsonl'));
        fs.mkdirSync(path.join(directory, 'quarantine-20260101-000000'));
        fs.symlinkSync(path.join(directory, 'chat_alice_20260101-000000.jsonl'), path.join(directory, 'chat_link_20260101-000000.jsonl'));

        const result = await stats.collectChatBackupStats(directory, { now: NOW });

        expect(result.total).toEqual({ files: 2, bytes: 30 });
        expect(result.series).toHaveLength(1);
        expect(result.unrecognized).toEqual({ files: 1, bytes: 20 });
    });

    test('previews the backups older than the given days and never lists a misnamed file for deletion', async () => {
        const directory = createBackups();
        writeBackup(directory, 'chat_alice_20250101-000000.jsonl', 10, 100);
        writeBackup(directory, 'chat_alice_20260101-000000.jsonl', 20, 29);
        writeBackup(directory, 'chat_alice_20260301-000000.jsonl', 40, 31);
        writeBackup(directory, 'chat_manual copy.jsonl', 80, 500);

        const result = await stats.collectChatBackupStats(directory, { now: NOW, olderThanDays: 30 });

        expect(result.olderThan).toMatchObject({ days: 30, files: 2, bytes: 50, namesTruncated: false });
        expect(result.olderThan.names.sort()).toEqual(['chat_alice_20250101-000000.jsonl', 'chat_alice_20260301-000000.jsonl']);
        // Nothing was deleted by asking
        expect(fs.readdirSync(directory)).toHaveLength(4);
    });

    test('caps the listed names but keeps counting', async () => {
        const directory = createBackups();
        for (let index = 0; index < stats.MAX_OLDER_THAN_NAMES + 3; index++) {
            writeBackup(directory, `chat_bulk_20250101-${String(index).padStart(6, '0')}.jsonl`, 1, 100);
        }

        const result = await stats.collectChatBackupStats(directory, { now: NOW, olderThanDays: 30 });

        expect(result.olderThan.files).toBe(stats.MAX_OLDER_THAN_NAMES + 3);
        expect(result.olderThan.names).toHaveLength(stats.MAX_OLDER_THAN_NAMES);
        expect(result.olderThan.namesTruncated).toBe(true);
    });

    test('a missing backups directory means no backups', async () => {
        const directory = createBackups();

        const result = await stats.collectChatBackupStats(path.join(directory, 'missing'), { now: NOW });

        expect(result.total).toEqual({ files: 0, bytes: 0 });
        expect(result.series).toEqual([]);
    });

    test('reads only the directory listing and file metadata, never the content', async () => {
        const directory = createBackups();
        writeBackup(directory, 'chat_alice_20260101-000000.jsonl', 10, 1);
        const readFile = jest.spyOn(fs.promises, 'readFile');
        const open = jest.spyOn(fs.promises, 'open');

        await stats.collectChatBackupStats(directory, { now: NOW });

        expect(readFile).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });

    test('olderThanDays must be a whole number of days', () => {
        expect(stats.parseOlderThanDays(30)).toBe(30);
        for (const bad of [0, -1, 1.5, '30', null, undefined, stats.MAX_OLDER_THAN_DAYS + 1]) {
            expect(stats.parseOlderThanDays(bad)).toBeNull();
        }
    });
});

describe('chat backup stats endpoint', () => {
    function createResponse() {
        return {
            statusCode: 200,
            body: undefined,
            sendStatus: jest.fn(function (code) {
                this.statusCode = code;
                return this;
            }),
            status: jest.fn(function (code) {
                this.statusCode = code;
                return this;
            }),
            send: jest.fn(function (value) {
                this.body = value;
                return this;
            }),
            json: jest.fn(function (value) {
                this.body = value;
                return this;
            }),
        };
    }

    test('answers with the stats and the effective backup settings', async () => {
        const directory = createBackups();
        writeBackup(directory, 'chat_alice_20260101-000000.jsonl', 10, 1);
        const response = createResponse();

        await statsHandler({ body: {}, user: { directories: { backups: directory } } }, response);

        expect(response.statusCode).toBe(200);
        expect(response.body.total).toEqual({ files: 1, bytes: 10 });
        expect(response.body.config).toEqual({
            enabled: expect.any(Boolean),
            checkIntegrity: expect.any(Boolean),
            numberOfBackups: expect.any(Number),
            maxTotalBackups: expect.any(Number),
            throttleInterval: expect.any(Number),
            allowFullDataBackup: expect.any(Boolean),
        });
        expect(response.body.config.numberOfBackups).toBeGreaterThan(0);
    });

    test('rejects an olderThanDays that is not a whole number of days', async () => {
        const directory = createBackups();
        const response = createResponse();

        await statsHandler({ body: { olderThanDays: -5 }, user: { directories: { backups: directory } } }, response);

        expect(response.statusCode).toBe(400);
    });
});

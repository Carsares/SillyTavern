import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';

let removeOldBackups;
let isBackupOfSeries;
const tempDirectories = [];

beforeAll(async () => {
    const util = await import('../src/util.js');
    util.setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ removeOldBackups, isBackupOfSeries } = util);
});

afterEach(() => {
    delete process.env.SILLYTAVERN_BACKUPS_COMMON_NUMBEROFBACKUPS;
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-backup-rotation-'));
    tempDirectories.push(directory);
    return directory;
}

/** Creates files whose modification time rises in the order given. */
function writeBackups(directory, names) {
    names.forEach((name, index) => {
        const filePath = path.join(directory, name);
        fs.writeFileSync(filePath, name);
        const time = new Date(Date.UTC(2026, 0, 1, 0, 0, index));
        fs.utimesSync(filePath, time, time);
    });
}

describe('backup series matching', () => {
    test('a series file is exactly prefix + timestamp + extension', () => {
        expect(isBackupOfSeries('chat_alice_20260101-120000.jsonl', 'chat_alice_')).toBe(true);
        expect(isBackupOfSeries('settings_default-user_20260101-120000.json', 'settings_default-user_')).toBe(true);
        expect(isBackupOfSeries('chat_alice_2_20260101-120000.jsonl', 'chat_alice_')).toBe(false);
        expect(isBackupOfSeries('chat_alice__x_20260101-120000.jsonl', 'chat_alice_')).toBe(false);
        expect(isBackupOfSeries('chat_alice_manual.jsonl', 'chat_alice_')).toBe(false);
        expect(isBackupOfSeries('chat_alice_20260101-120000', 'chat_alice_')).toBe(false);
        expect(isBackupOfSeries('chat_alice_2026-01-01.jsonl', 'chat_alice_')).toBe(false);
    });
});

describe('removeOldBackups', () => {
    test('per-series rotation removes the oldest backups of the series and leaves a series that shares its prefix alone', () => {
        process.env.SILLYTAVERN_BACKUPS_COMMON_NUMBEROFBACKUPS = '2';
        const directory = createDirectory();
        // "alice" and a character called "alice 2" (sanitized to alice_2): the second name starts with "chat_alice_"
        writeBackups(directory, [
            'chat_alice_2_20260101-000001.jsonl',
            'chat_alice_2_20260101-000002.jsonl',
            'chat_alice_2_20260101-000003.jsonl',
            'chat_alice_20260101-000010.jsonl',
            'chat_alice_20260101-000011.jsonl',
            'chat_alice_20260101-000012.jsonl',
        ]);

        // Called the way chats.js does it: only the series prefix, the limit comes from the config
        removeOldBackups(directory, 'chat_alice_');

        expect(fs.readdirSync(directory).sort()).toEqual([
            'chat_alice_2_20260101-000001.jsonl',
            'chat_alice_2_20260101-000002.jsonl',
            'chat_alice_2_20260101-000003.jsonl',
            'chat_alice_20260101-000011.jsonl',
            'chat_alice_20260101-000012.jsonl',
        ].sort());
    });

    test('the plain prefix match (what the rotation did before) removes a backup of the other character', () => {
        const directory = createDirectory();
        writeBackups(directory, [
            'chat_alice_2_20260101-000001.jsonl',
            'chat_alice_20260101-000010.jsonl',
            'chat_alice_20260101-000011.jsonl',
        ]);

        removeOldBackups(directory, 'chat_alice_', 2, { series: false });

        expect(fs.readdirSync(directory)).not.toContain('chat_alice_2_20260101-000001.jsonl');
    });

    test('the series that is a prefix of the other no longer loses backups when the longer name rotates', () => {
        process.env.SILLYTAVERN_BACKUPS_COMMON_NUMBEROFBACKUPS = '2';
        const directory = createDirectory();
        writeBackups(directory, [
            'chat_alice_20260101-000001.jsonl',
            'chat_alice_20260101-000002.jsonl',
            'chat_alice_2_20260101-000010.jsonl',
            'chat_alice_2_20260101-000011.jsonl',
            'chat_alice_2_20260101-000012.jsonl',
        ]);

        removeOldBackups(directory, 'chat_alice_2_');

        expect(fs.readdirSync(directory).sort()).toEqual([
            'chat_alice_20260101-000001.jsonl',
            'chat_alice_20260101-000002.jsonl',
            'chat_alice_2_20260101-000011.jsonl',
            'chat_alice_2_20260101-000012.jsonl',
        ].sort());
    });

    test('files that are not timestamped backups of the series are never removed by the rotation', () => {
        process.env.SILLYTAVERN_BACKUPS_COMMON_NUMBEROFBACKUPS = '1';
        const directory = createDirectory();
        writeBackups(directory, [
            'chat_alice_manual-copy.jsonl',
            'chat_alice_20260101-000001.jsonl',
            'chat_alice_20260101-000002.jsonl',
        ]);

        removeOldBackups(directory, 'chat_alice_');

        expect(fs.readdirSync(directory).sort()).toEqual(['chat_alice_20260101-000002.jsonl', 'chat_alice_manual-copy.jsonl']);
    });

    test('settings snapshots of a handle do not match the snapshots of a handle that continues with a hyphen', () => {
        process.env.SILLYTAVERN_BACKUPS_COMMON_NUMBEROFBACKUPS = '1';
        const directory = createDirectory();
        writeBackups(directory, [
            'settings_alice-2_20260101-000001.json',
            'settings_alice_20260101-000010.json',
            'settings_alice_20260101-000011.json',
        ]);

        // The series prefix ends with the underscore; the old call used `settings_alice` and matched both users
        removeOldBackups(directory, 'settings_alice_');

        expect(fs.readdirSync(directory).sort()).toEqual(['settings_alice-2_20260101-000001.json', 'settings_alice_20260101-000011.json']);
    });

    test('an explicit limit caps a whole family of series by prefix', () => {
        const directory = createDirectory();
        writeBackups(directory, [
            'chat_alice_20260101-000001.jsonl',
            'chat_bob_20260101-000002.jsonl',
            'chat_alice_2_20260101-000003.jsonl',
            'chat_carol_20260101-000004.jsonl',
            'settings_alice_20260101-000000.json',
        ]);

        // The user-wide cap of chats.js: every chat backup counts, other files do not
        removeOldBackups(directory, 'chat_', 2);

        expect(fs.readdirSync(directory).sort()).toEqual([
            'chat_alice_2_20260101-000003.jsonl',
            'chat_carol_20260101-000004.jsonl',
            'settings_alice_20260101-000000.json',
        ].sort());
    });

    test('the series option can force either matching mode', () => {
        const directory = createDirectory();
        writeBackups(directory, [
            'chat_x_2_20260101-000001.jsonl',
            'chat_x_20260101-000002.jsonl',
            'chat_x_20260101-000003.jsonl',
        ]);

        removeOldBackups(directory, 'chat_x_', 1, { series: true });
        expect(fs.readdirSync(directory).sort()).toEqual(['chat_x_2_20260101-000001.jsonl', 'chat_x_20260101-000003.jsonl'].sort());

        removeOldBackups(directory, 'chat_x_', 1, { series: false });
        expect(fs.readdirSync(directory)).toEqual(['chat_x_20260101-000003.jsonl']);
    });
});

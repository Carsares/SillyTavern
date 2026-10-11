import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

let snapshots;
let deleteRoute;
let pruneRoute;
const tempDirectories = [];

const HANDLE = 'alice';

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    snapshots = await import('../src/settings-snapshots.js');
    const { router } = await import('../src/endpoints/settings.js');
    deleteRoute = router.stack.find(layer => layer.route?.path === '/delete-snapshot').route;
    pruneRoute = router.stack.find(layer => layer.route?.path === '/prune-snapshots').route;
});

beforeEach(() => {
    // The file name middleware logs every refused name
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createBackups() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-snapshots-'));
    tempDirectories.push(root);
    const backups = path.join(root, 'backups');
    fs.mkdirSync(backups);
    return { root, backups };
}

function writeSnapshot(backups, name, content = '{}') {
    fs.writeFileSync(path.join(backups, name), content);
}

function snapshotName(handle, stamp) {
    return `settings_${handle}_${stamp}.json`;
}

/** Creates snapshots one after another so that the change time (what the endpoints sort by) rises with the index. */
async function writeSnapshotSeries(backups, handle, count) {
    const names = [];
    for (let index = 0; index < count; index++) {
        const name = snapshotName(handle, `20260101-0000${String(index).padStart(2, '0')}`);
        writeSnapshot(backups, name, `{"i":${index}}`);
        names.push(name);
        await new Promise(resolve => setTimeout(resolve, 15));
    }
    return names;
}

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

/** Runs the whole route stack (name validation middleware first, then the handler) like express does. */
async function callRoute(route, backups, body, handle = HANDLE) {
    const response = createResponse();
    const request = { body, user: { profile: { handle }, directories: { backups } } };
    for (const layer of route.stack) {
        let proceeded = false;
        await layer.handle(request, response, () => {
            proceeded = true;
        });
        if (!proceeded) {
            return response;
        }
    }
    return response;
}

describe('settings snapshot names', () => {
    test('accepts only the exact file name this server writes for the handle', () => {
        expect(snapshots.isSnapshotName('alice', 'settings_alice_20260101-120000.json')).toBe(true);
        expect(snapshots.isSnapshotName('default-user', 'settings_default-user_20260101-120000.json')).toBe(true);
        for (const bad of [
            'settings_bob_20260101-120000.json',
            'settings_alice_2_20260101-120000.json',
            'settings_alice_20260101-120000.json.bak',
            'settings_alice_manual.json',
            'settings_alice_20260101-120000.jsonl',
            'prefix/settings_alice_20260101-120000.json',
            '../settings_alice_20260101-120000.json',
            'settings_alice_20260101-120000.json/..',
            '',
            null,
            ['settings_alice_20260101-120000.json'],
        ]) {
            expect(snapshots.isSnapshotName('alice', bad)).toBe(false);
        }
        // A handle with regular-expression characters is matched literally
        expect(snapshots.isSnapshotName('a.b', 'settings_axb_20260101-120000.json')).toBe(false);
        expect(snapshots.isSnapshotName('a.b', 'settings_a.b_20260101-120000.json')).toBe(true);
    });

    test('keep must be a whole number from 1 up', () => {
        expect(snapshots.parseKeepCount(1)).toBe(1);
        expect(snapshots.parseKeepCount(50)).toBe(50);
        for (const bad of [0, -1, 1.5, '5', null, undefined, NaN, Infinity, snapshots.MAX_PRUNE_KEEP + 1]) {
            expect(snapshots.parseKeepCount(bad)).toBeNull();
        }
    });
});

describe('delete-snapshot', () => {
    test('deletes an older snapshot, answers with its size, and leaves the others', async () => {
        const { backups } = createBackups();
        const [oldest, middle, newest] = await writeSnapshotSeries(backups, HANDLE, 3);

        const response = await callRoute(deleteRoute, backups, { name: middle });

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({ ok: true, name: middle, size: fs.statSync(path.join(backups, oldest)).size });
        expect(fs.readdirSync(backups).sort()).toEqual([oldest, newest].sort());
    });

    test('refuses the newest snapshot', async () => {
        const { backups } = createBackups();
        const [, newest] = await writeSnapshotSeries(backups, HANDLE, 2);

        const response = await callRoute(deleteRoute, backups, { name: newest });

        expect(response.statusCode).toBe(409);
        expect(fs.existsSync(path.join(backups, newest))).toBe(true);
    });

    const refusedNames = [
        ['another user\'s snapshot', 'settings_bob_20260101-000000.json'],
        ['a snapshot of a handle that starts with this handle and an underscore', 'settings_alice_2_20260101-000000.json'],
        ['a name that is not a snapshot name', 'settings_alice_manual.json'],
        ['a chat backup', 'chat_alice_20260101-000000.jsonl'],
        ['a missing name', undefined],
        ['a number', 42],
        ['an array', ['settings_alice_20260101-000000.json']],
    ];
    for (const [label, name] of refusedNames) {
        test(`refuses ${label} without deleting anything`, async () => {
            const { backups } = createBackups();
            const names = await writeSnapshotSeries(backups, HANDLE, 2);
            for (const file of ['settings_bob_20260101-000000.json', 'settings_alice_2_20260101-000000.json', 'settings_alice_manual.json', 'chat_alice_20260101-000000.jsonl']) {
                writeSnapshot(backups, file);
            }
            const before = fs.readdirSync(backups).sort();

            const response = await callRoute(deleteRoute, backups, { name });

            expect([400, 404]).toContain(response.statusCode);
            expect(fs.readdirSync(backups).sort()).toEqual(before);
            expect(names.every(file => fs.existsSync(path.join(backups, file)))).toBe(true);
        });
    }

    const pathLikeNames = [
        'settings_alice_20260101-000000.json/../../outside.txt',
        '../settings_alice_20260101-000000.json',
        '..\\settings_alice_20260101-000000.json',
        'settings_alice_20260101-000000.json\u0000.txt',
    ];
    for (const name of pathLikeNames) {
        test(`refuses the path-like name ${JSON.stringify(name)} and leaves files outside the backups directory alone`, async () => {
            const { root, backups } = createBackups();
            fs.writeFileSync(path.join(root, 'outside.txt'), 'keep');
            fs.writeFileSync(path.join(root, 'settings_alice_20260101-000000.json'), 'keep too');
            await writeSnapshotSeries(backups, HANDLE, 2);

            const response = await callRoute(deleteRoute, backups, { name });

            expect(response.statusCode).toBe(400);
            expect(fs.readFileSync(path.join(root, 'outside.txt'), 'utf8')).toBe('keep');
            expect(fs.readFileSync(path.join(root, 'settings_alice_20260101-000000.json'), 'utf8')).toBe('keep too');
            expect(fs.readdirSync(backups)).toHaveLength(2);
        });
    }

    test('reports a snapshot that does not exist', async () => {
        const { backups } = createBackups();
        await writeSnapshotSeries(backups, HANDLE, 2);

        const response = await callRoute(deleteRoute, backups, { name: snapshotName(HANDLE, '20250101-000000') });

        expect(response.statusCode).toBe(404);
    });

    test('does not follow a symbolic link that has a snapshot name', async () => {
        const { root, backups } = createBackups();
        await writeSnapshotSeries(backups, HANDLE, 2);
        const target = path.join(root, 'important.json');
        fs.writeFileSync(target, 'important');
        const linkName = snapshotName(HANDLE, '20240101-000000');
        fs.symlinkSync(target, path.join(backups, linkName));

        const response = await callRoute(deleteRoute, backups, { name: linkName });

        expect(response.statusCode).toBe(400);
        expect(fs.readFileSync(target, 'utf8')).toBe('important');
        expect(fs.lstatSync(path.join(backups, linkName)).isSymbolicLink()).toBe(true);
    });
});

describe('prune-snapshots', () => {
    test('previews by default: lists what would go and deletes nothing', async () => {
        const { backups } = createBackups();
        const names = await writeSnapshotSeries(backups, HANDLE, 5);

        const response = await callRoute(pruneRoute, backups, { keep: 2 });

        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({ dryRun: true, keep: 2, total: 5, kept: 2, deleted: [], skipped: [], freedBytes: 0 });
        expect(response.body.candidates.map(item => item.name).sort()).toEqual(names.slice(0, 3).sort());
        expect(fs.readdirSync(backups)).toHaveLength(5);
    });

    test('deletes the older snapshots only with dryRun:false and keeps the newest ones', async () => {
        const { backups } = createBackups();
        const names = await writeSnapshotSeries(backups, HANDLE, 5);

        const response = await callRoute(pruneRoute, backups, { keep: 2, dryRun: false });

        expect(response.body.dryRun).toBe(false);
        expect(response.body.deleted.sort()).toEqual(names.slice(0, 3).sort());
        expect(response.body.freedBytes).toBeGreaterThan(0);
        expect(fs.readdirSync(backups).sort()).toEqual(names.slice(3).sort());
    });

    test('keep 1 still keeps the newest snapshot', async () => {
        const { backups } = createBackups();
        const names = await writeSnapshotSeries(backups, HANDLE, 3);

        await callRoute(pruneRoute, backups, { keep: 1, dryRun: false });

        expect(fs.readdirSync(backups)).toEqual([names[2]]);
    });

    test('only touches this user\'s snapshots, leaves look-alike names alone, and counts nothing else', async () => {
        const { backups } = createBackups();
        const names = await writeSnapshotSeries(backups, HANDLE, 3);
        const others = ['settings_bob_20250101-000000.json', 'settings_alice_2_20250101-000000.json', 'settings_alice_manual.json', 'chat_alice_20250101-000000.jsonl'];
        others.forEach(name => writeSnapshot(backups, name));

        const response = await callRoute(pruneRoute, backups, { keep: 1, dryRun: false });

        expect(response.body.deleted.sort()).toEqual(names.slice(0, 2).sort());
        expect(others.every(name => fs.existsSync(path.join(backups, name)))).toBe(true);
    });

    test('a name list limits the delete to snapshots the caller was shown and reports the rest', async () => {
        const { backups } = createBackups();
        const names = await writeSnapshotSeries(backups, HANDLE, 4);

        const response = await callRoute(pruneRoute, backups, { keep: 2, dryRun: false, names: [names[0], names[3], 'settings_alice_20200101-000000.json'] });

        expect(response.body.deleted).toEqual([names[0]]);
        expect(response.body.skipped).toEqual(expect.arrayContaining([
            { name: names[3], reason: 'not-in-prune-set' },
            { name: 'settings_alice_20200101-000000.json', reason: 'not-in-prune-set' },
        ]));
        expect(fs.existsSync(path.join(backups, names[3]))).toBe(true);
        expect(fs.existsSync(path.join(backups, names[1]))).toBe(true);
    });

    const invalidRequests = [
        { keep: 0 },
        { keep: -3 },
        { keep: 2.5 },
        { keep: '3' },
        {},
        { keep: 2, names: 'settings_alice_20260101-000000.json' },
        { keep: 2, names: [5] },
    ];
    for (const body of invalidRequests) {
        test(`rejects the invalid request ${JSON.stringify(body)}`, async () => {
            const { backups } = createBackups();
            await writeSnapshotSeries(backups, HANDLE, 3);

            const response = await callRoute(pruneRoute, backups, { dryRun: false, ...body });

            expect(response.statusCode).toBe(400);
            expect(fs.readdirSync(backups)).toHaveLength(3);
        });
    }
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from '@jest/globals';

import { isEntryModule } from '../server.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(repositoryRoot, 'server.js');
const tempRoots = [];

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createTempRoot(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(root);
    return root;
}

/** A data root whose storage initialization rejects, so the server fails before listening. */
function createFailingDataRoot() {
    const dataRoot = createTempRoot('st-startup-rejection-');
    fs.writeFileSync(path.join(dataRoot, 'cookie-secret.txt'), 'test-secret');
    fs.writeFileSync(path.join(dataRoot, '_storage'), 'not-a-directory');
    return dataRoot;
}

function runNode(args, { env = {} } = {}) {
    return spawnSync(process.execPath, args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, ...env },
        timeout: 10_000,
    });
}

function startupOutcome(result) {
    const stderr = String(result.stderr);
    return {
        error: result.error,
        signal: result.signal,
        status: result.status,
        reportedCriticalError: stderr.includes('A critical error has occurred while starting the server:'),
        reportedStorageError: stderr.includes('ENOTDIR'),
    };
}

const STARTUP_REJECTION = { error: undefined, signal: null, status: 1, reportedCriticalError: true, reportedStorageError: true };

describe('server startup failure', () => {
    test('propagates an asynchronous storage initialization rejection with exit code 1', () => {
        const dataRoot = createFailingDataRoot();
        expect(startupOutcome(runNode(['server.js', '--dataRoot', dataRoot, '--browserLaunchEnabled', 'false']))).toEqual(STARTUP_REJECTION);
    });

    test('starts through a symlinked entry path', () => {
        const dataRoot = createFailingDataRoot();
        const link = path.join(createTempRoot('st-entry-link-'), 'sillytavern-server.js');
        fs.symlinkSync(serverEntry, link);
        expect(startupOutcome(runNode([link, '--dataRoot', dataRoot, '--browserLaunchEnabled', 'false']))).toEqual(STARTUP_REJECTION);
    });

    test('starts when a PM2-style container imports it and exits even with open handles', () => {
        const dataRoot = createFailingDataRoot();
        const container = path.join(createTempRoot('st-pm2-container-'), 'ProcessContainerFork.mjs');
        // PM2 keeps an IPC channel open; an interval stands in for it so a failed start must exit explicitly.
        fs.writeFileSync(container, [
            'import { pathToFileURL } from \'node:url\';',
            'setInterval(() => {}, 1000);',
            'await import(pathToFileURL(process.env.pm_exec_path).href);',
        ].join('\n'));
        expect(startupOutcome(runNode([container, '--dataRoot', dataRoot, '--browserLaunchEnabled', 'false'], { env: { pm_exec_path: serverEntry } }))).toEqual(STARTUP_REJECTION);
    });
});

describe('server entry detection', () => {
    const moduleUrl = pathToFileURL(serverEntry).href;
    const detect = (argv1, pmExecPath) => isEntryModule({ argv: [process.execPath, argv1], env: pmExecPath ? { pm_exec_path: pmExecPath } : {} }, moduleUrl);

    test('recognizes direct, extensionless, package directory and symlinked entries', () => {
        const link = path.join(createTempRoot('st-entry-link-'), 'server.js');
        fs.symlinkSync(serverEntry, link);
        expect(detect(serverEntry)).toBe(true);
        expect(detect(path.join(repositoryRoot, 'server'))).toBe(true);
        expect(detect(repositoryRoot)).toBe(true);
        expect(detect(link)).toBe(true);
    });

    test('recognizes a PM2 container through pm_exec_path', () => {
        expect(detect('/opt/pm2/lib/ProcessContainerFork.js', serverEntry)).toBe(true);
    });

    test('does not start when another script imports main', () => {
        expect(detect(path.join(repositoryRoot, 'src', 'server-global.js'))).toBe(false);
        expect(detect(path.join(repositoryRoot, 'tests', 'server-startup-failure.test.js'))).toBe(false);
        expect(detect('/opt/pm2/lib/ProcessContainerFork.js', path.join(repositoryRoot, 'src', 'server-global.js'))).toBe(false);
        expect(detect(undefined)).toBe(false);
        expect(detect(path.join(createTempRoot('st-entry-missing-'), 'missing.js'))).toBe(false);
    });
});

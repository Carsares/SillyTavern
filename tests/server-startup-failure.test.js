import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

describe('server startup failure', () => {
    test('propagates an asynchronous storage initialization rejection with exit code 1', () => {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'st-startup-rejection-'));
        fs.writeFileSync(path.join(dataRoot, 'cookie-secret.txt'), 'test-secret');
        fs.writeFileSync(path.join(dataRoot, '_storage'), 'not-a-directory');

        try {
            const testDirectory = path.dirname(fileURLToPath(import.meta.url));
            const result = spawnSync(process.execPath, ['server.js', '--dataRoot', dataRoot, '--browserLaunchEnabled', 'false'], {
                cwd: path.resolve(testDirectory, '..'),
                encoding: 'utf8',
                timeout: 10_000,
            });

            expect(result.error).toBeUndefined();
            expect(result.signal).toBeNull();
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('A critical error has occurred while starting the server:');
            expect(result.stderr).toContain('ENOTDIR');
        } finally {
            fs.rmSync(dataRoot, { recursive: true, force: true });
        }
    });
});

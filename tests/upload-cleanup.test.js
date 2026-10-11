import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import uploadCleanupMiddleware from '../src/middleware/uploadCleanup.js';

const tempRoots = [];

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createUpload() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-upload-cleanup-'));
    const file = path.join(root, 'upload');
    tempRoots.push(root);
    fs.writeFileSync(file, 'temporary upload');
    return file;
}

describe('temporary upload cleanup', () => {
    test('removes an unclaimed upload when the response finishes', async () => {
        const file = createUpload();
        const response = new EventEmitter();
        const next = jest.fn();

        uploadCleanupMiddleware({ file: { path: file } }, response, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(file)).toBe(true);

        response.emit('finish');
        await new Promise(resolve => setImmediate(resolve));

        expect(fs.existsSync(file)).toBe(false);
    });

    test('removes an unclaimed upload when the connection closes', async () => {
        const file = createUpload();
        const response = new EventEmitter();

        uploadCleanupMiddleware({ file: { path: file } }, response, jest.fn());
        response.emit('close');
        await new Promise(resolve => setImmediate(resolve));

        expect(fs.existsSync(file)).toBe(false);
    });

    test('does not fail when the endpoint already removed the upload', async () => {
        const file = createUpload();
        const response = new EventEmitter();

        uploadCleanupMiddleware({ file: { path: file } }, response, jest.fn());
        fs.unlinkSync(file);
        response.emit('finish');
        await new Promise(resolve => setImmediate(resolve));

        expect(fs.existsSync(file)).toBe(false);
    });
});

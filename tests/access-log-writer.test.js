import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../src/util.js', () => ({
    getConfigValue: jest.fn((_key, defaultValue) => defaultValue),
}));

jest.unstable_mockModule('../src/express-common.js', () => ({
    getIpAddress: jest.fn(() => '127.0.0.1'),
}));

let accessLogWriter;
const tempRoots = [];

beforeAll(async () => {
    accessLogWriter = await import('../src/middleware/accessLogWriter.js');
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createTempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-access-log-'));
    tempRoots.push(root);
    return root;
}

describe('backend interface access log writer', () => {
    test('groups log paths by local date', () => {
        const date = new Date(2026, 6, 3, 23, 15, 0);
        expect(accessLogWriter.formatDateDirectory(date)).toBe('2026-07-03');
        expect(accessLogWriter.getAccessLogPath(date, '/tmp/logs')).toBe('/tmp/logs/2026-07-03/access.log');
        expect(accessLogWriter.getErrorLogPath(date, '/tmp/logs')).toBe('/tmp/logs/2026-07-03/error.log');
    });

    test('logs backend interface paths only', () => {
        expect(accessLogWriter.shouldLogBackendRequestPath('/api/settings/get')).toBe(true);
        expect(accessLogWriter.shouldLogBackendRequestPath('/api')).toBe(true);
        expect(accessLogWriter.shouldLogBackendRequestPath('/csrf-token')).toBe(true);
        expect(accessLogWriter.shouldLogBackendRequestPath('/thumbnail')).toBe(true);
        expect(accessLogWriter.shouldLogBackendRequestPath('/proxy/http%3A%2F%2Fexample.test')).toBe(true);
        expect(accessLogWriter.shouldLogBackendRequestPath('/scripts/app.js')).toBe(false);
    });

    test('formats access and status error entries without request body data', () => {
        const request = {
            method: 'POST',
            path: '/api/settings/save',
            headers: { 'user-agent': 'unit-test' },
            user: { profile: { handle: 'alice' } },
        };
        const response = {
            statusCode: 500,
            getHeader: jest.fn(() => 12),
        };
        const startAt = process.hrtime.bigint() - 1_000_000n;

        const accessEntry = accessLogWriter.createAccessLogEntry(request, response, startAt);
        expect(accessEntry).toEqual(expect.objectContaining({
            type: 'access',
            method: 'POST',
            path: '/api/settings/save',
            statusCode: 500,
            ip: '127.0.0.1',
            userAgent: 'unit-test',
            user: 'alice',
            contentLength: '12',
        }));
        expect(accessEntry.body).toBeUndefined();
        expect(accessEntry.durationMs).toBeGreaterThanOrEqual(0);

        const errorEntry = accessLogWriter.createStatusErrorLogEntry(request, response, startAt);
        expect(errorEntry).toEqual(expect.objectContaining({
            type: 'error',
            errorType: 'http_status',
            message: 'Backend interface completed with status 500',
        }));
    });

    test('cleans dated log directories older than one week', () => {
        const root = createTempRoot();
        fs.mkdirSync(path.join(root, '2026-06-25'), { recursive: true });
        fs.mkdirSync(path.join(root, '2026-06-26'), { recursive: true });
        fs.mkdirSync(path.join(root, '2026-07-03'), { recursive: true });
        fs.mkdirSync(path.join(root, 'manual'), { recursive: true });

        accessLogWriter.cleanupOldLogDirectories(new Date(2026, 6, 3, 10, 0, 0), root);

        expect(fs.existsSync(path.join(root, '2026-06-25'))).toBe(false);
        expect(fs.existsSync(path.join(root, '2026-06-26'))).toBe(true);
        expect(fs.existsSync(path.join(root, '2026-07-03'))).toBe(true);
        expect(fs.existsSync(path.join(root, 'manual'))).toBe(true);
    });
});

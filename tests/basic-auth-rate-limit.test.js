/* global globalThis */
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

globalThis.DATA_ROOT = '/tmp';

const getItem = jest.fn();

jest.unstable_mockModule('node-persist', () => ({
    default: { getItem },
}));

jest.unstable_mockModule('../src/users.js', () => ({
    getAllUserHandles: jest.fn(async () => ['target', 'attacker']),
    toKey: handle => `user:${handle}`,
    getPasswordHash: password => password,
}));

jest.unstable_mockModule('../src/util.js', () => ({
    getConfigValue: jest.fn((key, defaultValue) => {
        if (key === 'perUserBasicAuth' || key === 'enableUserAccounts') {
            return true;
        }
        if (key === 'rateLimiting.basicAuthMaxAttempts') {
            return 2;
        }
        return defaultValue;
    }),
    safeReadFileSync: jest.fn(() => ''),
}));

jest.unstable_mockModule('../src/express-common.js', () => ({
    getIpAddress: jest.fn(() => '203.0.113.10'),
    retryAfter: response => response,
}));

let basicAuthMiddleware;

beforeAll(async () => {
    ({ default: basicAuthMiddleware } = await import('../src/middleware/basicAuth.js'));
});

afterEach(() => {
    jest.restoreAllMocks();
});

function createResponse() {
    return {
        statusCode: 200,
        set: jest.fn(function () { return this; }),
        status(code) {
            this.statusCode = code;
            return this;
        },
        send: jest.fn(function () { return this; }),
        sendStatus: jest.fn(function (code) {
            this.statusCode = code;
            return this;
        }),
    };
}

async function authenticate(username, password) {
    const response = createResponse();
    const callback = jest.fn();
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    await basicAuthMiddleware({
        headers: { authorization: `Basic ${credentials}` },
        method: 'GET',
        originalUrl: '/',
    }, response, callback);
    return { callback, response };
}

describe('per-user Basic Auth rate limiting', () => {
    test('a successful login only clears attempts for the same account', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        getItem.mockImplementation(async key => {
            if (key === 'user:target') {
                return { enabled: true, password: 'correct', salt: 'salt' };
            }
            if (key === 'user:attacker') {
                return { enabled: true, password: 'own-password', salt: 'salt' };
            }
            return null;
        });

        for (let attempt = 0; attempt < 2; attempt++) {
            const { response } = await authenticate('target', 'wrong');
            expect(response.statusCode).toBe(401);
        }

        const ownLogin = await authenticate('attacker', 'own-password');
        expect(ownLogin.callback).toHaveBeenCalledTimes(1);

        const targetLogin = await authenticate('target', 'wrong');
        expect(targetLogin.response.statusCode).toBe(429);
    });
});

import { once } from 'node:events';

import express from 'express';
import bodyParser from 'body-parser';
import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const getUser = jest.fn();
const getUsers = jest.fn();
const getUserAvatar = jest.fn();

jest.unstable_mockModule('node-persist', () => ({
    default: {
        getItem: getUser,
        values: getUsers,
        setItem: jest.fn(),
    },
}));

jest.unstable_mockModule('../src/express-common.js', () => ({
    getIpAddress: jest.fn(() => '203.0.113.10'),
    retryAfter: response => response,
}));

jest.unstable_mockModule('../src/util.js', () => ({
    color: { blue: text => text, magenta: text => text },
    Cache: class {},
    getConfigValue: jest.fn((_key, defaultValue) => defaultValue),
}));

jest.unstable_mockModule('../src/users.js', () => ({
    KEY_PREFIX: 'user:',
    getUserAvatar,
    toKey: handle => `user:${handle}`,
    getPasswordHash: password => password,
    getPasswordSalt: jest.fn(),
    getAccountVersion: user => user.handle,
}));

let publicRouter;
let loginHandler;
let listHandler;

beforeAll(async () => {
    ({ router: publicRouter } = await import('../src/endpoints/users-public.js'));
    // The route stack starts with the per-route body parsers; the business handler is the last layer
    loginHandler = publicRouter.stack.find(layer => layer.route?.path === '/login').route.stack.at(-1).handle;
    listHandler = publicRouter.stack.find(layer => layer.route?.path === '/list').route.stack.at(-1).handle;
});

beforeEach(() => {
    getUser.mockReset();
    getUsers.mockReset();
    getUserAvatar.mockReset();
});

function createResponse() {
    return {
        headersSent: false,
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json: jest.fn(function () { return this; }),
        send: jest.fn(function () { return this; }),
        sendStatus: jest.fn(function (code) {
            this.statusCode = code;
            return this;
        }),
        set: jest.fn(function () { return this; }),
    };
}

async function login(handle, password) {
    const request = {
        body: { handle, password },
        session: {},
        socket: { remoteAddress: '203.0.113.10' },
    };
    const response = createResponse();
    await loginHandler(request, response);
    return response;
}

describe('user login rate limiting', () => {
    test('keeps bounded user avatars unchanged in the public list contract', async () => {
        const avatar = 'data:image/png;base64,bounded-avatar';
        getUsers.mockResolvedValue([{ handle: 'target', name: 'Target', enabled: true, created: 1, password: '' }]);
        getUserAvatar.mockResolvedValue(avatar);
        const response = createResponse();

        await listHandler({}, response);

        expect(response.json).toHaveBeenCalledWith([{
            handle: 'target',
            name: 'Target',
            created: 1,
            avatar,
            password: false,
        }]);
    });

    test('a successful login only clears attempts for the same account', async () => {
        getUser.mockImplementation(async key => {
            if (key === 'user:target') {
                return { handle: 'target', enabled: true, password: 'correct', salt: 'salt' };
            }
            if (key === 'user:attacker') {
                return { handle: 'attacker', enabled: true, password: 'own-password', salt: 'salt' };
            }
            return null;
        });

        for (let attempt = 0; attempt < 5; attempt++) {
            const response = await login('target', 'wrong');
            expect(response.statusCode).toBe(403);
        }

        const ownLoginResponse = await login('attacker', 'own-password');
        expect(ownLoginResponse.statusCode).toBe(200);

        const targetResponse = await login('target', 'wrong');
        expect(targetResponse.statusCode).toBe(429);
    });
});

describe('public user router body limits', () => {
    test('each public route carries its own body parsers rather than a shadowing router-level one', () => {
        // A router-level (non-route) middleware would parse bodies for every /api/users/* path,
        // including authenticated ones; the fix keeps parsers on the routes themselves.
        const routerLevelLayers = publicRouter.stack.filter(layer => !layer.route);
        expect(routerLevelLayers).toHaveLength(0);

        for (const path of ['/list', '/login', '/recover-step1', '/recover-step2']) {
            const route = publicRouter.stack.find(layer => layer.route?.path === path).route;
            // Parser middleware precedes the single business handler
            expect(route.stack.length).toBeGreaterThan(1);
        }
    });

    test('a large body on an authenticated /api/users route is not rejected by the public parsers', async () => {
        // Mirrors the src/server-main.js mount order: public router first, then the post-login
        // large-limit parser, then the authenticated routes.
        const app = express();
        app.use('/api/users', publicRouter);
        app.use(bodyParser.json({ limit: '500mb' }));
        app.post('/api/users/change-avatar', (request, response) => {
            response.json({ received: JSON.stringify(request.body).length });
        });

        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        try {
            const { port } = server.address();
            // 300 KB — well above the default 100kb body-parser limit, within the 2MB avatar allowance
            const avatar = 'x'.repeat(300 * 1024);
            const response = await fetch(`http://127.0.0.1:${port}/api/users/change-avatar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ handle: 'target', avatar }),
            });

            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.received).toBeGreaterThan(300 * 1024);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});

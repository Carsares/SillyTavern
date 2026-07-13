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

let loginHandler;
let listHandler;

beforeAll(async () => {
    const { router } = await import('../src/endpoints/users-public.js');
    loginHandler = router.stack.find(layer => layer.route?.path === '/login').route.stack[0].handle;
    listHandler = router.stack.find(layer => layer.route?.path === '/list').route.stack[0].handle;
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

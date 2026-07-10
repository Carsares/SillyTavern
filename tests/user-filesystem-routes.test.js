import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const getUser = jest.fn();
const removeUser = jest.fn();
const createBackupArchive = jest.fn();
const getUserDirectories = jest.fn();
const validateUserDataRoot = jest.fn();
const tempRoots = [];

jest.unstable_mockModule('node-persist', () => ({
    default: {
        getItem: getUser,
        removeItem: removeUser,
        values: jest.fn(),
        setItem: jest.fn(),
    },
}));

jest.unstable_mockModule('../src/users.js', () => ({
    KEY_PREFIX: 'user:',
    toKey: handle => `user:${handle}`,
    requireAdminMiddleware: (_request, _response, next) => next(),
    getUserAvatar: jest.fn(),
    getAllUserHandles: jest.fn(),
    getPasswordSalt: jest.fn(),
    getPasswordHash: jest.fn(),
    getUserDirectories,
    validateUserDataRoot,
    createBackupArchive,
    ensurePublicDirectoriesExist: jest.fn(),
    toAvatarKey: jest.fn(),
    getAccountVersion: jest.fn(),
}));

jest.unstable_mockModule('../src/endpoints/content-manager.js', () => ({
    checkForNewContent: jest.fn(),
    CONTENT_TYPES: { SETTINGS: 'settings' },
}));

jest.unstable_mockModule('../src/util.js', () => ({
    color: { magenta: text => text, red: text => text },
    Cache: class {},
    getConfigValue: jest.fn((_key, defaultValue) => defaultValue),
}));

let backupHandler;
let deleteHandler;

beforeAll(async () => {
    const [{ router: privateRouter }, { router: adminRouter }] = await Promise.all([
        import('../src/endpoints/users-private.js'),
        import('../src/endpoints/users-admin.js'),
    ]);
    backupHandler = privateRouter.stack.find(layer => layer.route?.path === '/backup').route.stack.at(-1).handle;
    deleteHandler = adminRouter.stack.find(layer => layer.route?.path === '/delete').route.stack.at(-1).handle;
});

beforeEach(() => {
    getUser.mockReset();
    removeUser.mockReset();
    createBackupArchive.mockReset();
    getUserDirectories.mockReset();
    validateUserDataRoot.mockReset();
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createResponse() {
    return {
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json: jest.fn(function () { return this; }),
        sendStatus: jest.fn(function (code) {
            this.statusCode = code;
            return this;
        }),
    };
}

describe('user filesystem routes', () => {
    test('backs up the canonical handle from the stored user record', async () => {
        getUser.mockResolvedValue({ handle: 'canonical-user' });
        const response = createResponse();

        await backupHandler({ body: { handle: 'requested-alias' }, user: { profile: { handle: 'admin', admin: true } } }, response);

        expect(getUser).toHaveBeenCalledWith('user:requested-alias');
        expect(createBackupArchive).toHaveBeenCalledWith('canonical-user', response);
    });

    test('validates and purges only the canonical stored user directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-user-delete-'));
        const userRoot = path.join(root, 'canonical-user');
        fs.mkdirSync(userRoot);
        tempRoots.push(root);
        getUser.mockResolvedValue({ handle: 'canonical-user' });
        getUserDirectories.mockReturnValue({ root: userRoot });
        const response = createResponse();

        await deleteHandler({ body: { handle: 'requested-alias', purge: true }, user: { profile: { handle: 'admin' } } }, response);

        expect(getUserDirectories).toHaveBeenCalledWith('canonical-user');
        expect(validateUserDataRoot).toHaveBeenCalledWith(userRoot);
        expect(removeUser).toHaveBeenCalledWith('user:requested-alias');
        expect(fs.existsSync(userRoot)).toBe(false);
        expect(response.statusCode).toBe(204);
    });
});

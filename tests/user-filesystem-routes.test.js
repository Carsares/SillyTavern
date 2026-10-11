import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { MAX_USER_AVATAR_DATA_URL_BYTES } from '../src/user-profile.js';

const getUser = jest.fn();
const removeUser = jest.fn();
const createBackupArchive = jest.fn();
const getUserDirectories = jest.fn();
const validateUserDataRoot = jest.fn();
const getAllUserHandles = jest.fn();
const setUser = jest.fn();
const tempRoots = [];

jest.unstable_mockModule('node-persist', () => ({
    default: {
        getItem: getUser,
        removeItem: removeUser,
        values: jest.fn(),
        setItem: setUser,
    },
}));

jest.unstable_mockModule('../src/users.js', () => ({
    KEY_PREFIX: 'user:',
    toKey: handle => `user:${handle}`,
    requireAdminMiddleware: (_request, _response, next) => next(),
    getUserAvatar: jest.fn(),
    getAllUserHandles,
    getPasswordSalt: jest.fn(),
    getPasswordHash: jest.fn(),
    getUserDirectories,
    validateUserDataRoot,
    createBackupArchive,
    ensurePublicDirectoriesExist: jest.fn(),
    toAvatarKey: handle => `avatar:${handle}`,
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
let changeAvatarHandler;
let changeNameHandler;
let createHandler;
let deleteHandler;

beforeAll(async () => {
    const [{ router: privateRouter }, { router: adminRouter }] = await Promise.all([
        import('../src/endpoints/users-private.js'),
        import('../src/endpoints/users-admin.js'),
    ]);
    backupHandler = privateRouter.stack.find(layer => layer.route?.path === '/backup').route.stack.at(-1).handle;
    changeAvatarHandler = privateRouter.stack.find(layer => layer.route?.path === '/change-avatar').route.stack.at(-1).handle;
    changeNameHandler = privateRouter.stack.find(layer => layer.route?.path === '/change-name').route.stack.at(-1).handle;
    createHandler = adminRouter.stack.find(layer => layer.route?.path === '/create').route.stack.at(-1).handle;
    deleteHandler = adminRouter.stack.find(layer => layer.route?.path === '/delete').route.stack.at(-1).handle;
});

beforeEach(() => {
    getUser.mockReset();
    removeUser.mockReset();
    createBackupArchive.mockReset();
    getUserDirectories.mockReset();
    validateUserDataRoot.mockReset();
    getAllUserHandles.mockReset();
    setUser.mockReset();
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
    test('accepts a bounded avatar and rejects one byte beyond the persistence limit', async () => {
        const prefix = 'data:image/png;base64,';
        const boundedAvatar = prefix + 'a'.repeat(MAX_USER_AVATAR_DATA_URL_BYTES - prefix.length);
        getUser.mockResolvedValue({ handle: 'target' });
        const acceptedResponse = createResponse();

        await changeAvatarHandler({ body: { handle: 'target', avatar: boundedAvatar }, user: { profile: { handle: 'target' } } }, acceptedResponse);

        expect(acceptedResponse.statusCode).toBe(204);
        expect(setUser).toHaveBeenCalledWith('avatar:target', boundedAvatar);

        setUser.mockClear();
        const rejectedResponse = createResponse();
        await changeAvatarHandler({ body: { handle: 'target', avatar: `${boundedAvatar}a` }, user: { profile: { handle: 'target' } } }, rejectedResponse);

        expect(rejectedResponse.statusCode).toBe(413);
        expect(setUser).not.toHaveBeenCalled();
    });

    test('keeps empty avatar clearing within the existing API contract', async () => {
        getUser.mockResolvedValue({ handle: 'target' });
        const response = createResponse();

        await changeAvatarHandler({ body: { handle: 'target', avatar: '' }, user: { profile: { handle: 'target' } } }, response);

        expect(response.statusCode).toBe(204);
        expect(setUser).toHaveBeenCalledWith('avatar:target', '');
    });

    test('counts display-name limits by Unicode code point for edits and account creation', async () => {
        const boundedName = '🙂'.repeat(128);
        const oversizedName = `${boundedName}🙂`;
        getUser.mockResolvedValue({ handle: 'target', name: 'Original' });
        const acceptedResponse = createResponse();

        await changeNameHandler({ body: { handle: 'target', name: boundedName }, user: { profile: { handle: 'target' } } }, acceptedResponse);

        expect(acceptedResponse.statusCode).toBe(204);
        expect(setUser).toHaveBeenCalledWith('user:target', expect.objectContaining({ name: boundedName }));

        setUser.mockClear();
        const rejectedEditResponse = createResponse();
        await changeNameHandler({ body: { handle: 'target', name: oversizedName }, user: { profile: { handle: 'target' } } }, rejectedEditResponse);

        expect(rejectedEditResponse.statusCode).toBe(400);
        expect(setUser).not.toHaveBeenCalled();

        const rejectedCreateResponse = createResponse();
        await createHandler({ body: { handle: 'new-user', name: oversizedName }, user: { profile: { handle: 'admin', admin: true } } }, rejectedCreateResponse);

        expect(rejectedCreateResponse.statusCode).toBe(400);
        expect(setUser).not.toHaveBeenCalled();
    });

    test('allows only one concurrent create for the same normalized handle', async () => {
        const handles = new Set();
        getAllUserHandles.mockImplementation(async () => [...handles]);
        setUser.mockImplementation(async (_key, user) => {
            handles.add(user.handle);
        });
        const firstResponse = createResponse();
        const secondResponse = createResponse();
        const firstRequest = { body: { handle: 'Same User', name: 'First' }, user: { profile: { handle: 'admin', admin: true } } };
        const secondRequest = { body: { handle: 'same-user', name: 'Second' }, user: { profile: { handle: 'admin', admin: true } } };

        await Promise.all([
            createHandler(firstRequest, firstResponse),
            createHandler(secondRequest, secondResponse),
        ]);

        expect(setUser).toHaveBeenCalledTimes(1);
        expect([firstResponse.statusCode, secondResponse.statusCode].toSorted()).toEqual([200, 409]);
    });

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

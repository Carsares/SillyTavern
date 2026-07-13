import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const clone = jest.fn();
const getRepositoryStatus = jest.fn();
const listBranches = jest.fn();
const switchBranch = jest.fn();
const update = jest.fn();
const createGitClient = jest.fn(() => ({ clone, getRepositoryStatus, listBranches, switchBranch, update }));
const getConfigValue = jest.fn((key, defaultValue) => {
    if (key === 'git.backend') return 'auto';
    if (key === 'privateAddressWhitelist.enabled') return true;
    return defaultValue;
});
let root;

jest.unstable_mockModule('../src/git/client.js', () => ({ createGitClient }));
jest.unstable_mockModule('../src/util.js', () => ({
    getConfigValue,
    isValidUrl: value => {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    },
}));
jest.unstable_mockModule('../src/constants.js', () => ({
    PUBLIC_DIRECTORIES: {
        extensions: path.join(root, 'built-in'),
        globalExtensions: path.join(root, 'global'),
    },
}));

let handlers;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-extension-network-'));
    const { router } = await import('../src/endpoints/extensions.js');
    handlers = Object.fromEntries(router.stack
        .filter(layer => layer.route)
        .map(layer => [layer.route.path, layer.route.stack.at(-1).handle]));
});

beforeEach(() => {
    jest.clearAllMocks();
    createGitClient.mockReturnValue({ clone, getRepositoryStatus, listBranches, switchBranch, update });
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function createResponse() {
    const response = { statusCode: 200 };
    response.status = jest.fn(code => {
        response.statusCode = code;
        return response;
    });
    response.send = jest.fn(value => value);
    response.sendStatus = jest.fn(code => {
        response.statusCode = code;
        return response;
    });
    return response;
}

describe('extension Git network safety', () => {
    test('routes the complete extension lifecycle through the filtered Git client', async () => {
        const extensions = path.join(root, 'user-extensions');
        const request = {
            body: { extensionName: 'safe-extension', url: 'https://example.com/safe-extension.git' },
            user: { profile: { handle: 'user', admin: false }, directories: { extensions } },
        };
        clone.mockImplementationOnce(async (_url, extensionPath) => {
            fs.mkdirSync(extensionPath, { recursive: true });
            fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));
        });
        update.mockResolvedValue({ currentBranchName: 'main', currentCommitHash: '1234567890', isUpToDate: false, remoteUrl: request.body.url });
        listBranches.mockResolvedValue([{ current: true, commit: '123456789', name: 'main', label: 'Initial commit' }]);
        switchBranch.mockResolvedValue(true);
        getRepositoryStatus.mockResolvedValue({ currentBranchName: 'main', currentCommitHash: '1234567890', isUpToDate: true, remoteUrl: request.body.url });

        await handlers['/install'](request, createResponse());
        await handlers['/update'](request, createResponse());
        await handlers['/branches'](request, createResponse());
        await handlers['/switch']({ ...request, body: { ...request.body, branch: 'main' } }, createResponse());
        await handlers['/version'](request, createResponse());

        expect(createGitClient).toHaveBeenCalledTimes(5);
        expect(createGitClient).toHaveBeenCalledWith({ backend: 'auto', requireFilteredNetwork: true });
        expect(clone).toHaveBeenCalledWith(request.body.url, path.join(extensions, 'safe-extension'), { depth: 1 });
        expect(update).toHaveBeenCalledWith(path.join(extensions, 'safe-extension'));
        expect(listBranches).toHaveBeenCalledWith(path.join(extensions, 'safe-extension'));
        expect(switchBranch).toHaveBeenCalledWith(path.join(extensions, 'safe-extension'), 'main');
        expect(getRepositoryStatus).toHaveBeenCalledWith(path.join(extensions, 'safe-extension'));
    });
});

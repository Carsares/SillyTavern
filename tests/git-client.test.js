import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const commandExists = jest.fn();
const isomorphicGit = {
    checkout: jest.fn(),
    clone: jest.fn(),
    currentBranch: jest.fn(),
    fetch: jest.fn(),
    findMergeBase: jest.fn(),
    listBranches: jest.fn(),
    listRemotes: jest.fn(),
    log: jest.fn(),
    pull: jest.fn(),
    resolveRef: jest.fn(),
};
const systemGit = {
    branchLocal: jest.fn(),
    checkout: jest.fn(),
    clone: jest.fn(),
};
const simpleGit = jest.fn(() => systemGit);
const httpClient = { request: jest.fn() };

jest.unstable_mockModule('command-exists', () => ({ sync: commandExists }));
jest.unstable_mockModule('isomorphic-git', () => ({ default: isomorphicGit }));
jest.unstable_mockModule('isomorphic-git/http/node', () => ({ default: httpClient }));
jest.unstable_mockModule('simple-git', () => ({
    CheckRepoActions: { IS_REPO_ROOT: 'is-repo-root' },
    default: simpleGit,
}));

let createGitClient;

beforeAll(async () => {
    ({ createGitClient } = await import('../src/git/client.js'));
});

beforeEach(() => {
    jest.clearAllMocks();
    commandExists.mockReturnValue(true);
});

describe('git backend resolution', () => {
    const backendCases = [
        ['system', false, true, 'system'],
        ['builtin', false, true, 'builtin'],
        ['auto', false, true, 'system'],
        ['auto', false, false, 'builtin'],
        ['auto', true, true, 'builtin'],
        ['builtin', true, true, 'builtin'],
        ['system', true, true, 'system'],
    ];

    for (const [backend, requireFilteredNetwork, systemGitAvailable, expected] of backendCases) {
        test(`resolves backend=${backend}, filter=${requireFilteredNetwork}, systemGit=${systemGitAvailable} to ${expected}`, () => {
            commandExists.mockReturnValue(systemGitAvailable);

            const client = createGitClient({ backend, requireFilteredNetwork });

            expect(client.backend).toBe(expected);
        });
    }

    test('rejects a configured system backend when git is unavailable', () => {
        commandExists.mockReturnValue(false);

        expect(() => createGitClient({ backend: 'system' }))
            .toThrow('System git backend is configured, but no git binary was found in PATH.');
    });
});

describe('git client network transport', () => {
    test('keeps system clone behavior when filtered networking is disabled', async () => {
        const client = createGitClient({ backend: 'system' });

        await client.clone('https://example.com/repository.git', '/tmp/repository', { depth: 1 });

        expect(systemGit.clone).toHaveBeenCalledWith('https://example.com/repository.git', '/tmp/repository', { '--depth': 1 });
        expect(isomorphicGit.clone).not.toHaveBeenCalled();
    });

    test('blocks remote system-git operations when the private request filter is required', async () => {
        const client = createGitClient({ backend: 'system', requireFilteredNetwork: true });
        const operations = [
            () => client.clone('https://example.com/repository.git', '/tmp/repository', { depth: 1 }),
            () => client.getRepositoryStatus('/tmp/repository'),
            () => client.update('/tmp/repository'),
            () => client.listBranches('/tmp/repository'),
        ];

        for (const operation of operations) {
            await expect(operation()).rejects.toThrow('System git backend is incompatible with the enabled private request filter');
        }
        expect(simpleGit).not.toHaveBeenCalled();
    });

    test('still allows local branch switching with system git when the request filter is enabled', async () => {
        systemGit.branchLocal.mockResolvedValue({ all: ['main'], current: 'main' });
        const client = createGitClient({ backend: 'system', requireFilteredNetwork: true });

        await expect(client.switchBranch('/tmp/repository', 'main')).resolves.toBe(true);

        expect(systemGit.checkout).not.toHaveBeenCalled();
    });

    test('uses the builtin HTTP transport for auto backend when filtering is required', async () => {
        const client = createGitClient({ backend: 'auto', requireFilteredNetwork: true });

        await client.clone('https://example.com/repository.git', '/tmp/repository', { depth: 1, branch: 'main' });

        expect(commandExists).not.toHaveBeenCalled();
        expect(simpleGit).not.toHaveBeenCalled();
        expect(isomorphicGit.clone).toHaveBeenCalledWith(expect.objectContaining({
            http: httpClient,
            dir: '/tmp/repository',
            url: 'https://example.com/repository.git',
            depth: 1,
            ref: 'main',
            singleBranch: true,
        }));
    });

    test('uses the builtin HTTP transport for fetch and pull', async () => {
        isomorphicGit.resolveRef.mockImplementation(async ({ ref }) => ref === 'HEAD' ? 'local-commit' : 'remote-commit');
        isomorphicGit.currentBranch.mockResolvedValue('main');
        isomorphicGit.listRemotes.mockResolvedValue([{ remote: 'origin', url: 'https://example.com/repository.git' }]);
        isomorphicGit.findMergeBase.mockResolvedValue(['common-commit']);
        isomorphicGit.log.mockResolvedValue([{ commit: { author: { name: 'Extension Author', email: 'extension@example.com' } } }]);
        const client = createGitClient({ backend: 'auto', requireFilteredNetwork: true });

        await client.update('/tmp/repository');

        expect(isomorphicGit.fetch).toHaveBeenCalledWith(expect.objectContaining({ http: httpClient, dir: '/tmp/repository', remote: 'origin' }));
        expect(isomorphicGit.pull).toHaveBeenCalledWith(expect.objectContaining({
            http: httpClient,
            dir: '/tmp/repository',
            remote: 'origin',
            ref: 'main',
            author: { name: 'Extension Author', email: 'extension@example.com' },
        }));
    });
});

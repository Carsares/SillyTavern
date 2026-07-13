import fs from 'node:fs';

import { sync as commandExistsSync } from 'command-exists';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import simpleGit, { CheckRepoActions } from 'simple-git';

/** @type {{ AUTO: 'auto', SYSTEM: 'system', BUILTIN: 'builtin' }} */
export const GIT_BACKENDS = {
    AUTO: 'auto',
    SYSTEM: 'system',
    BUILTIN: 'builtin',
};

const SYSTEM_REPOSITORY_OPTIONS = Object.freeze({ timeout: { block: 5 * 60 * 1000 } });
const SUPPORTED_CLONE_OPTIONS = new Set(['depth', 'branch']);

/**
 * @typedef {object} GitCloneOptions
 * @property {number} [depth]
 * @property {string} [branch]
 */

/**
 * @typedef {object} GitRepositoryStatus
 * @property {string} currentBranchName
 * @property {string} currentCommitHash
 * @property {boolean} isUpToDate
 * @property {string} remoteUrl
 */

/**
 * @typedef {object} GitBranch
 * @property {boolean} current
 * @property {string} commit
 * @property {string} name
 * @property {string} label
 */

/**
 * @typedef {object} GitClient
 * @property {'system' | 'builtin'} backend
 * @property {(url: string, localPath: string, options?: GitCloneOptions) => Promise<void>} clone
 * @property {(localPath: string) => Promise<GitRepositoryStatus | null>} getRepositoryStatus
 * @property {(localPath: string) => Promise<GitRepositoryStatus>} update
 * @property {(localPath: string) => Promise<GitBranch[]>} listBranches
 * @property {(localPath: string, branch: string) => Promise<boolean>} switchBranch
 */

/**
 * @param {string | undefined | null} preferredBackend
 * @param {boolean} requireFilteredNetwork
 * @returns {'system' | 'builtin'}
 */
function resolveBackend(preferredBackend, requireFilteredNetwork) {
    const normalized = typeof preferredBackend === 'string' ? preferredBackend.trim().toLowerCase() : GIT_BACKENDS.AUTO;
    const backend = normalized === GIT_BACKENDS.SYSTEM
        ? GIT_BACKENDS.SYSTEM
        : normalized === GIT_BACKENDS.BUILTIN
            ? GIT_BACKENDS.BUILTIN
            : GIT_BACKENDS.AUTO;

    if (backend === GIT_BACKENDS.BUILTIN || (backend === GIT_BACKENDS.AUTO && requireFilteredNetwork)) {
        return GIT_BACKENDS.BUILTIN;
    }

    const systemGitAvailable = commandExistsSync('git');
    if (backend === GIT_BACKENDS.SYSTEM && !systemGitAvailable) {
        throw new Error('System git backend is configured, but no git binary was found in PATH.');
    }

    return systemGitAvailable ? GIT_BACKENDS.SYSTEM : GIT_BACKENDS.BUILTIN;
}

/**
 * @param {GitCloneOptions} [options]
 * @returns {{ depth?: number, branch?: string }}
 */
function normalizeCloneOptions(options = {}) {
    for (const key of Object.keys(options)) {
        if (!SUPPORTED_CLONE_OPTIONS.has(key)) {
            throw new Error(`Unsupported clone option: ${key}`);
        }
    }
    return { depth: options.depth, branch: options.branch };
}

/**
 * Creates a Git client for all extension repository operations.
 * @param {{ backend?: string, requireFilteredNetwork?: boolean }} [options]
 * @returns {GitClient}
 */
export function createGitClient(options = {}) {
    const requireFilteredNetwork = Boolean(options.requireFilteredNetwork);
    const backend = resolveBackend(options.backend, requireFilteredNetwork);
    if (backend === GIT_BACKENDS.SYSTEM) {
        // System git is still usable for local-only operations, but it cannot honor Node's filtered HTTP agents.
        return new SimpleGitClient({ remoteNetworkAllowed: !requireFilteredNetwork });
    }

    return new IsomorphicGitClient();
}

/**
 * @implements {GitClient}
 */
class SimpleGitClient {
    /**
     * @param {{ remoteNetworkAllowed: boolean }} options
     */
    constructor({ remoteNetworkAllowed }) {
        this.backend = GIT_BACKENDS.SYSTEM;
        this.remoteNetworkAllowed = remoteNetworkAllowed;
    }

    #assertRemoteNetworkAllowed() {
        if (!this.remoteNetworkAllowed) {
            throw new Error('System git backend is incompatible with the enabled private request filter. Use git.backend: builtin or auto for remote Git operations.');
        }
    }

    /**
     * @param {string} localPath
     */
    #getRepository(localPath) {
        return simpleGit({ baseDir: localPath, ...SYSTEM_REPOSITORY_OPTIONS });
    }

    /**
     * @param {string} url
     * @param {string} localPath
     * @param {GitCloneOptions} [options]
     * @returns {Promise<void>}
     */
    async clone(url, localPath, options = {}) {
        this.#assertRemoteNetworkAllowed();
        const { depth, branch } = normalizeCloneOptions(options);
        /** @type {Record<string, any>} */
        const cloneOptions = {};

        if (depth !== undefined) {
            cloneOptions['--depth'] = depth;
        }

        if (branch) {
            cloneOptions['--branch'] = branch;
        }

        await simpleGit().clone(url, localPath, cloneOptions);
    }

    /**
     * @param {string} localPath
     * @returns {Promise<GitRepositoryStatus | null>}
     */
    async getRepositoryStatus(localPath) {
        this.#assertRemoteNetworkAllowed();
        const repository = this.#getRepository(localPath);
        if (!await repository.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)) {
            return null;
        }

        const currentBranchName = (await repository.branch()).current;
        const currentCommitHash = await repository.revparse(['HEAD']);
        const remotes = await repository.getRemotes(true);
        if (remotes.length === 0) {
            return { currentBranchName, currentCommitHash, isUpToDate: true, remoteUrl: '' };
        }

        await repository.fetch('origin');
        const log = await repository.log({ from: currentCommitHash, to: `origin/${currentBranchName}` });
        return {
            currentBranchName,
            currentCommitHash,
            isUpToDate: log.total === 0,
            remoteUrl: remotes[0].refs.fetch,
        };
    }

    /**
     * @param {string} localPath
     * @returns {Promise<GitRepositoryStatus>}
     */
    async update(localPath) {
        this.#assertRemoteNetworkAllowed();
        const status = await this.getRepositoryStatus(localPath);
        if (!status) {
            throw new Error(`Directory is not a Git repository at ${localPath}`);
        }

        const repository = this.#getRepository(localPath);
        if (!status.isUpToDate) {
            await repository.pull('origin', status.currentBranchName);
        }
        if (status.remoteUrl) {
            await repository.fetch('origin');
        }

        return { ...status, currentCommitHash: await repository.revparse(['HEAD']) };
    }

    /**
     * @param {string} localPath
     * @returns {Promise<GitBranch[]>}
     */
    async listBranches(localPath) {
        this.#assertRemoteNetworkAllowed();
        const repository = this.#getRepository(localPath);
        if (await repository.revparse(['--is-shallow-repository']) === 'true') {
            await repository.fetch('origin', ['--unshallow']);
        }

        await repository.remote(['set-branches', 'origin', '*']);
        await repository.fetch('origin');
        const localBranches = await repository.branchLocal();
        const remoteBranches = await repository.branch(['-r', '--list', 'origin/*']);
        return [...Object.values(localBranches.branches), ...Object.values(remoteBranches.branches)]
            .map(branch => ({ current: branch.current, commit: branch.commit, name: branch.name, label: branch.label }));
    }

    /**
     * @param {string} localPath
     * @param {string} branch
     * @returns {Promise<boolean>}
     */
    async switchBranch(localPath, branch) {
        const repository = this.#getRepository(localPath);
        const branches = await repository.branchLocal();

        if (branch.startsWith('origin/')) {
            const localBranch = branch.replace('origin/', '');
            if (branches.all.includes(localBranch)) {
                await repository.checkout(localBranch);
            } else {
                await repository.checkoutBranch(localBranch, branch);
            }
            return true;
        }

        if (!branches.all.includes(branch)) {
            return false;
        }

        if (branches.current !== branch) {
            await repository.checkout(branch);
        }
        return true;
    }
}

/**
 * @implements {GitClient}
 */
class IsomorphicGitClient {
    constructor() {
        this.backend = GIT_BACKENDS.BUILTIN;
    }

    /**
     * @param {string} url
     * @param {string} localPath
     * @param {GitCloneOptions} [options]
     * @returns {Promise<void>}
     */
    async clone(url, localPath, options = {}) {
        const { depth, branch } = normalizeCloneOptions(options);
        await git.clone({
            fs,
            http,
            dir: localPath,
            url,
            depth,
            ref: branch,
            singleBranch: depth !== undefined || Boolean(branch),
        });
    }

    /**
     * @param {string} localPath
     * @returns {Promise<GitRepositoryStatus | null>}
     */
    async getRepositoryStatus(localPath) {
        let currentCommitHash;
        try {
            currentCommitHash = await git.resolveRef({ fs, dir: localPath, ref: 'HEAD' });
        } catch {
            return null;
        }

        const currentBranchName = await git.currentBranch({ fs, dir: localPath }) || '';
        const remotes = await git.listRemotes({ fs, dir: localPath });
        if (remotes.length === 0) {
            return { currentBranchName, currentCommitHash, isUpToDate: true, remoteUrl: '' };
        }

        await git.fetch({ fs, http, dir: localPath, remote: 'origin' });
        const remoteCommitHash = await git.resolveRef({ fs, dir: localPath, ref: `refs/remotes/origin/${currentBranchName}` });
        const mergeBases = await git.findMergeBase({ fs, dir: localPath, oids: [currentCommitHash, remoteCommitHash] });
        return {
            currentBranchName,
            currentCommitHash,
            isUpToDate: remoteCommitHash === currentCommitHash || mergeBases.includes(remoteCommitHash),
            remoteUrl: remotes[0].url,
        };
    }

    /**
     * @param {string} localPath
     * @returns {Promise<GitRepositoryStatus>}
     */
    async update(localPath) {
        const status = await this.getRepositoryStatus(localPath);
        if (!status) {
            throw new Error(`Directory is not a Git repository at ${localPath}`);
        }

        if (!status.isUpToDate) {
            // isomorphic-git requires an identity even for fast-forward pulls; reuse the current commit identity.
            const [currentCommit] = await git.log({ fs, dir: localPath, ref: 'HEAD', depth: 1 });
            const author = { name: currentCommit.commit.author.name, email: currentCommit.commit.author.email };
            await git.pull({ fs, http, dir: localPath, remote: 'origin', ref: status.currentBranchName, singleBranch: true, author, committer: author });
        }
        if (status.remoteUrl) {
            await git.fetch({ fs, http, dir: localPath, remote: 'origin' });
        }

        return { ...status, currentCommitHash: await git.resolveRef({ fs, dir: localPath, ref: 'HEAD' }) };
    }

    /**
     * @param {string} localPath
     * @returns {Promise<GitBranch[]>}
     */
    async listBranches(localPath) {
        await git.fetch({ fs, http, dir: localPath, remote: 'origin' });
        const currentBranchName = await git.currentBranch({ fs, dir: localPath }) || '';
        const localBranches = await git.listBranches({ fs, dir: localPath });
        const remoteBranches = await git.listBranches({ fs, dir: localPath, remote: 'origin' });
        return await Promise.all([
            ...localBranches.map(branch => this.#getBranch(localPath, branch, branch === currentBranchName)),
            ...remoteBranches.map(branch => this.#getBranch(localPath, `origin/${branch}`, false)),
        ]);
    }

    /**
     * @param {string} localPath
     * @param {string} branch
     * @returns {Promise<boolean>}
     */
    async switchBranch(localPath, branch) {
        const localBranches = await git.listBranches({ fs, dir: localPath });
        const currentBranchName = await git.currentBranch({ fs, dir: localPath }) || '';

        if (branch.startsWith('origin/')) {
            const localBranch = branch.replace('origin/', '');
            if (currentBranchName !== localBranch) {
                await git.checkout({ fs, dir: localPath, remote: 'origin', ref: localBranch });
            }
            return true;
        }

        if (!localBranches.includes(branch)) {
            return false;
        }

        if (currentBranchName !== branch) {
            await git.checkout({ fs, dir: localPath, ref: branch });
        }
        return true;
    }

    /**
     * @param {string} localPath
     * @param {string} branch
     * @param {boolean} current
     * @returns {Promise<GitBranch>}
     */
    async #getBranch(localPath, branch, current) {
        const commitHash = await git.resolveRef({ fs, dir: localPath, ref: branch });
        const [commit] = await git.log({ fs, dir: localPath, ref: branch, depth: 1 });
        return {
            current,
            commit: commitHash.slice(0, 9),
            name: branch,
            label: commit?.commit.message.split(/\r?\n/u, 1)[0] || '',
        };
    }
}

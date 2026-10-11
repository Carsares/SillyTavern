#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Start the existing application; Agent services are mounted inside its authenticated server. */
export async function main({ process: hostProcess = process, loadBootstrap = () => import('./src/workspace-bootstrap.js') } = {}) {
    const [major, minor] = hostProcess.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw new Error('Node.js 22.19 or newer is required');
    const { startWorkspace } = await loadBootstrap();
    return startWorkspace(hostProcess);
}

/**
 * Whether the process was started to run this file, so that importing `main` (tests, `src/server-global.js`) does not start it.
 * Node resolves the entry script like `require.resolve` and follows symlinks, while `argv[1]` keeps the path as typed.
 * PM2 runs its own container script as `argv[1]` and imports the application from `pm_exec_path`.
 * @param {{ argv: string[], env: Record<string, string | undefined> }} [hostProcess] Process to inspect
 * @param {string} [moduleUrl] URL of the module that may be the entry
 * @returns {boolean} True when `argv[1]` or `pm_exec_path` resolves to the module file
 */
export function isEntryModule(hostProcess = process, moduleUrl = import.meta.url) {
    const resolveScript = script => {
        try {
            return realpathSync(createRequire(moduleUrl).resolve(path.resolve(script)));
        } catch {
            return null;
        }
    };
    const self = resolveScript(fileURLToPath(moduleUrl));
    return self !== null && [hostProcess.argv?.[1], hostProcess.env?.pm_exec_path]
        .some(script => typeof script === 'string' && script !== '' && resolveScript(script) === self);
}

if (isEntryModule()) {
    main().catch(error => {
        console.error('A critical error has occurred while starting the server:', error);
        process.exit(1);
    });
}

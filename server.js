#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/** Start the existing application; Agent services are mounted inside its authenticated server. */
export async function main({ process: hostProcess = process, loadBootstrap = () => import('./src/workspace-bootstrap.js') } = {}) {
    const [major, minor] = hostProcess.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw new Error('Node.js 22.19 or newer is required');
    const { startWorkspace } = await loadBootstrap();
    return startWorkspace(hostProcess);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch(error => {
        console.error('A critical error has occurred while starting the server:', error);
        process.exitCode = 1;
    });
}

#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/** Version validation precedes imports that require node:sqlite or newer SDK syntax. */
export async function main({ process: hostProcess = process, log = console, loadServer = () => import('./src/conversation/server.js') } = {}) {
    const [major, minor] = hostProcess.versions.node.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) throw new Error('Node.js 22.19 or newer is required');
    const { startServer, parseArguments } = await loadServer();
    const application = await startServer(parseArguments(hostProcess.argv.slice(2)));
    log.log(`Conversation v1 listening on ${application.address.address}:${application.address.port}`);
    let closing;
    const shutdown = () => {
        closing ??= Promise.resolve().then(() => application.close()).catch(() => {
            log.error('Shutdown failed'); hostProcess.exitCode = 1;
        }).finally(() => {
            for (const signal of ['SIGINT', 'SIGTERM']) hostProcess.removeListener(signal, shutdown);
        });
        return closing;
    };
    for (const signal of ['SIGINT', 'SIGTERM']) hostProcess.once(signal, shutdown);
    return application;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main().catch(() => { console.error('Conversation v1 failed to start'); process.exitCode = 1; });
}

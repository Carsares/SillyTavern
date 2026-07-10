/**
 * Creates the process shutdown handler.
 * @param {object} options Shutdown dependencies
 * @param {() => Promise<void>} options.saveStats Persists pending statistics
 * @param {undefined | (() => Promise<void>)} options.cleanupPlugins Cleans up loaded plugins
 * @param {() => void} options.disposeCache Disposes the disk cache
 * @param {() => void} options.restoreWindowTitle Restores the original window title
 * @param {(exitCode: number) => void} options.exit Terminates the process
 * @returns {(exitCode?: number) => Promise<void>}
 */
export function createExitHandler({ saveStats, cleanupPlugins, disposeCache, restoreWindowTitle, exit }) {
    let isExiting = false;
    let requestedExitCode = 0;

    return async function exitProcess(exitCode = 0) {
        requestedExitCode = Math.max(requestedExitCode, exitCode);
        if (isExiting) {
            return;
        }
        isExiting = true;

        const cleanupTasks = [
            ['statistics', saveStats],
            ['plugins', cleanupPlugins],
            ['disk cache', disposeCache],
            ['window title', restoreWindowTitle],
        ];

        for (const [name, cleanup] of cleanupTasks) {
            if (typeof cleanup !== 'function') {
                continue;
            }
            try {
                await cleanup();
            } catch (error) {
                requestedExitCode = 1;
                console.error(`Failed to clean up ${name}:`, error);
            }
        }

        exit(requestedExitCode);
    };
}

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { createExitHandler } from '../src/server-exit.js';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('server shutdown', () => {
    test('uses the requested exit code after all cleanup succeeds', async () => {
        const saveStats = jest.fn();
        const cleanupPlugins = jest.fn();
        const disposeCache = jest.fn();
        const restoreWindowTitle = jest.fn();
        const exit = jest.fn();
        const exitProcess = createExitHandler({ saveStats, cleanupPlugins, disposeCache, restoreWindowTitle, exit });

        await exitProcess(1);

        expect(saveStats).toHaveBeenCalledTimes(1);
        expect(cleanupPlugins).toHaveBeenCalledTimes(1);
        expect(disposeCache).toHaveBeenCalledTimes(1);
        expect(restoreWindowTitle).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
    });

    test('continues cleanup and exits with code 1 when a cleanup rejects', async () => {
        const error = new Error('plugin cleanup failed');
        const saveStats = jest.fn();
        const cleanupPlugins = jest.fn().mockRejectedValue(error);
        const disposeCache = jest.fn();
        const restoreWindowTitle = jest.fn();
        const exit = jest.fn();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const exitProcess = createExitHandler({ saveStats, cleanupPlugins, disposeCache, restoreWindowTitle, exit });

        await exitProcess();

        expect(disposeCache).toHaveBeenCalledTimes(1);
        expect(restoreWindowTitle).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith('Failed to clean up plugins:', error);
        expect(exit).toHaveBeenCalledWith(1);
    });

    test('runs cleanup only once when shutdown is requested concurrently', async () => {
        let finishStats;
        const saveStats = jest.fn(() => new Promise(resolve => {
            finishStats = resolve;
        }));
        const exit = jest.fn();
        const exitProcess = createExitHandler({
            saveStats,
            disposeCache: jest.fn(),
            restoreWindowTitle: jest.fn(),
            exit,
        });

        const firstExit = exitProcess();
        await exitProcess(1);
        finishStats();
        await firstExit;

        expect(saveStats).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(1);
    });
});

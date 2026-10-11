import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const webpack = jest.fn();
const getPublicLibConfig = jest.fn(() => ({
    output: { path: '/tmp', filename: 'lib.js' },
    stats: 'errors-only',
}));

jest.unstable_mockModule('webpack', () => ({ default: webpack }));
jest.unstable_mockModule('../webpack.config.js', () => ({ default: getPublicLibConfig }));

const { default: getWebpackServeMiddleware } = await import('../src/middleware/webpack-serve.js');

beforeEach(() => {
    webpack.mockReset();
    getPublicLibConfig.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

function createCompiler({ runError = null, hasErrors = false, closeError = null } = {}) {
    return {
        run: jest.fn(callback => callback(runError, {
            hasErrors: () => hasErrors,
            toString: () => '',
        })),
        close: jest.fn(callback => callback(closeError)),
    };
}

describe('Webpack startup compilation', () => {
    test('rejects when the compiler reports a fatal error', async () => {
        const error = new Error('compiler failed');
        webpack.mockReturnValue(createCompiler({ runError: error }));

        await expect(getWebpackServeMiddleware().runWebpackCompiler()).rejects.toBe(error);
    });

    test('rejects when compilation stats contain errors', async () => {
        webpack.mockReturnValue(createCompiler({ hasErrors: true }));

        await expect(getWebpackServeMiddleware().runWebpackCompiler()).rejects.toThrow('Webpack compilation failed');
    });

    test('rejects when closing the compiler fails', async () => {
        const error = new Error('close failed');
        webpack.mockReturnValue(createCompiler({ closeError: error }));

        await expect(getWebpackServeMiddleware().runWebpackCompiler()).rejects.toBe(error);
    });

    test('resolves only after a successful compile and close', async () => {
        const compiler = createCompiler();
        webpack.mockReturnValue(compiler);

        await expect(getWebpackServeMiddleware().runWebpackCompiler()).resolves.toBeUndefined();
        expect(compiler.run).toHaveBeenCalledTimes(1);
        expect(compiler.close).toHaveBeenCalledTimes(1);
    });
});

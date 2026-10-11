import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let koboldRouter;
let officialContentProvider;
let searchRemoteResources;
let formatHttpErrorMessage;

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router: koboldRouter } = await import('../src/endpoints/backends/kobold.js'));
    ({ officialContentProvider } = await import('../src/remote-resources/providers/official-content.js'));
    ({ searchRemoteResources } = await import('../src/remote-resources/provider-registry.js'));
    ({ formatHttpErrorMessage } = await import('../src/remote-resources/providers/shared.js'));
});

let tempRoots = [];

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots) {
        fs.rmSync(root, { recursive: true, force: true });
    }
    tempRoots = [];
});

// Remote resource search reads per-user provider preferences from directories.root, like request.user.directories in the endpoint.
function createUserDirectories(preferences) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-remote-search-'));
    tempRoots.push(root);
    if (preferences) {
        fs.mkdirSync(path.join(root, 'remote-resources'), { recursive: true });
        fs.writeFileSync(path.join(root, 'remote-resources', 'provider-preferences.json'), JSON.stringify(preferences));
    }
    return { root };
}

function getRouteHandler(router, routePath) {
    const route = router.stack.find(layer => layer.route?.path === routePath)?.route;
    if (!route) {
        throw new Error(`Route not found: ${routePath}`);
    }
    return route.stack[route.stack.length - 1].handle;
}

function createResponse() {
    const response = {};
    response.sendStatus = jest.fn(value => value);
    return response;
}

describe('backend endpoint safety', () => {
    test('rejects a missing Kobold API server', async () => {
        for (const routePath of ['/generate', '/status']) {
            const response = createResponse();

            await getRouteHandler(koboldRouter, routePath)({ body: {} }, response);

            expect(response.sendStatus).toHaveBeenCalledWith(400);
        }
    });

    test('searches each remote resource provider at most once per request', async () => {
        const search = jest.spyOn(officialContentProvider, 'search').mockResolvedValue({ items: [], total: 0 });

        await searchRemoteResources({ providers: Array(100).fill(officialContentProvider.id) }, createUserDirectories());

        expect(search).toHaveBeenCalledTimes(1);
    });

    test('skips a remote resource provider the user disabled even when it is requested explicitly', async () => {
        const search = jest.spyOn(officialContentProvider, 'search').mockResolvedValue({ items: [], total: 0 });

        const result = await searchRemoteResources({ providers: [officialContentProvider.id] }, createUserDirectories({ [officialContentProvider.id]: false }));

        expect(search).not.toHaveBeenCalled();
        expect(result).toEqual({ items: [], total: 0, errors: [], providerErrors: [] });
    });

    test('reports provider failures with the provider name and without upstream HTML', async () => {
        const page = '<!doctype html> <html lang="en"> <head> <meta charset="utf-8" /> <script>window.x = "<b>";</script> </head> <body><h1>Not   Found</h1></body></html>';
        jest.spyOn(officialContentProvider, 'search').mockRejectedValue(new Error(`Remote request failed: 404 Not Found - ${page}`));

        const result = await searchRemoteResources({ providers: [officialContentProvider.id] }, createUserDirectories());

        expect(result.providerErrors).toEqual([{
            providerId: officialContentProvider.id,
            providerName: officialContentProvider.name,
            message: 'Remote request failed: 404 Not Found - Not Found',
        }]);
        expect(result.errors).toEqual([`${officialContentProvider.name}: Remote request failed: 404 Not Found - Not Found`]);
    });

    test('keeps only the status and a short excerpt of a failed remote response body', () => {
        const response = (status, statusText, contentType) => ({ status, statusText, headers: { get: () => contentType } });
        const errorPage = '<!doctype html><html><head><title>Just a moment...</title><script>var a = 1;</script></head><body>challenge</body></html>';

        expect(formatHttpErrorMessage('Remote request failed', response(403, 'Forbidden', 'text/html; charset=UTF-8'), errorPage))
            .toBe('Remote request failed: 403 Forbidden - Just a moment...');
        expect(formatHttpErrorMessage('Remote request failed', response(404, 'Not Found', null), '<!DOCTYPE html><html><body>missing</body></html>'))
            .toBe('Remote request failed: 404 Not Found');
        expect(formatHttpErrorMessage('Search failed', response(500, '', 'application/json'), JSON.stringify({ error: 'boom' })))
            .toBe('Search failed: 500 - {"error":"boom"}');
        const long = formatHttpErrorMessage('Search failed', response(502, 'Bad Gateway', 'text/plain'), 'x'.repeat(500));
        expect(long.length).toBeLessThanOrEqual('Search failed: 502 Bad Gateway - '.length + 123);
    });
});

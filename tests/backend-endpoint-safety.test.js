import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let koboldRouter;
let officialContentProvider;
let searchRemoteResources;

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router: koboldRouter } = await import('../src/endpoints/backends/kobold.js'));
    ({ officialContentProvider } = await import('../src/remote-resources/providers/official-content.js'));
    ({ searchRemoteResources } = await import('../src/remote-resources/provider-registry.js'));
});

afterEach(() => {
    jest.restoreAllMocks();
});

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

        await searchRemoteResources({ providers: Array(100).fill(officialContentProvider.id) }, {});

        expect(search).toHaveBeenCalledTimes(1);
    });
});

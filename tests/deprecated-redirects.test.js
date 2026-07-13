import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { setConfigFilePath } from '../src/util.js';

let redirectDeprecatedEndpoints;

beforeAll(async () => {
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ redirectDeprecatedEndpoints } = await import('../src/server-startup.js'));
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('deprecated endpoint redirects', () => {
    test('resolves the image folder parameter and preserves its query string', async () => {
        const app = express();
        redirectDeprecatedEndpoints(app);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');

        try {
            const address = server.address();
            const response = await fetch(`http://127.0.0.1:${address.port}/listimgfiles/%E8%A7%92%E8%89%B2%20images?sort=name&limit=2`, {
                method: 'POST',
                redirect: 'manual',
            });

            expect(response.status).toBe(308);
            expect(response.headers.get('location')).toBe('/api/images/list/%E8%A7%92%E8%89%B2%20images?sort=name&limit=2');
            expect(warn).toHaveBeenCalledWith('API endpoint /listimgfiles/:folder is deprecated; use /api/images/list/%E8%A7%92%E8%89%B2%20images?sort=name&limit=2 instead');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});

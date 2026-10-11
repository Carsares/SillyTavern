import http from 'node:http';
import https from 'node:https';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import gitHttp from 'isomorphic-git/http/node';

import initPrivateRequestFilter from '../src/private-request-filter.js';

let server;
let serverUrl;
let originalHttpGlobalAgent;
let originalHttpsGlobalAgent;

beforeAll(async () => {
    originalHttpGlobalAgent = http.globalAgent;
    originalHttpsGlobalAgent = https.globalAgent;
    server = http.createServer((request, response) => {
        if (request.url === '/redirect-private') {
            response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
            response.end();
            return;
        }

        response.end('ok');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
    http.globalAgent = originalHttpGlobalAgent;
    https.globalAgent = originalHttpsGlobalAgent;
    await new Promise(resolve => server.close(resolve));
});

function enablePrivateRequestFilter(privateAddressWhitelist = []) {
    initPrivateRequestFilter({
        listen: false,
        enabled: true,
        privateAddressWhitelist,
        logBlocked: false,
        logAllowed: false,
        allowUnresolvedHosts: false,
        enableKeepAlive: false,
    });
}

describe('isomorphic-git private request filtering', () => {
    test('blocks a direct request to a private address', async () => {
        enablePrivateRequestFilter();

        await expect(gitHttp.request({ url: `${serverUrl}/direct-private` }))
            .rejects
            .toThrow('Blocked request to private IP address: 127.0.0.1');
    });

    test('checks every redirect against the private address filter', async () => {
        enablePrivateRequestFilter(['127.0.0.0/8']);

        await expect(gitHttp.request({ url: `${serverUrl}/redirect-private` }))
            .rejects
            .toThrow('Blocked request to private IP address: 169.254.169.254');
    });
});

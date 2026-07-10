import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();
const forwardFetchResponse = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
    default: fetchMock,
}));

jest.unstable_mockModule('../src/util.js', () => ({
    forwardFetchResponse,
}));

let corsProxyMiddleware;

beforeAll(async () => {
    ({ default: corsProxyMiddleware } = await import('../src/middleware/corsProxy.js'));
});

beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({});
    forwardFetchResponse.mockReset().mockResolvedValue(undefined);
});

describe('CORS proxy request headers', () => {
    test('does not forward credentials or hop-by-hop headers', async () => {
        const request = {
            params: { url: 'https://example.test/resource' },
            protocol: 'http',
            method: 'POST',
            body: { value: true },
            headers: {
                authorization: 'Basic server-credentials',
                'proxy-authorization': 'Basic proxy-credentials',
                connection: 'keep-alive, x-remove-me',
                'keep-alive': 'timeout=5',
                'x-remove-me': 'connection-scoped',
                'content-length': '999',
                'x-api-key': 'upstream-key',
            },
            get: jest.fn(() => 'localhost:8000'),
        };
        const response = {};

        await corsProxyMiddleware(request, response);

        const headers = fetchMock.mock.calls[0][1].headers;
        expect(headers).toEqual({ 'x-api-key': 'upstream-key' });
        expect(forwardFetchResponse).toHaveBeenCalledWith({}, response);
    });
});

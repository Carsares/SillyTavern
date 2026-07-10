import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { abortControllerOnClientClose, setConfigFilePath } from '../src/util.js';

const fetchMock = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({
    readSecret: () => 'test-secret',
    SECRET_KEYS: { COMFY_RUNPOD: 'api_key_comfy_runpod' },
}));

let runPodGenerateHandler;
let googleVideoHandler;
let openAiVideoHandler;
let zaiVideoHandler;

beforeAll(async () => {
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const [{ router: stableDiffusionRouter }, { router: googleRouter }, { router: openAiRouter }] = await Promise.all([
        import('../src/endpoints/stable-diffusion.js'),
        import('../src/endpoints/google.js'),
        import('../src/endpoints/openai.js'),
    ]);
    const runPodRouter = stableDiffusionRouter.stack.find(layer => String(layer.regexp).includes('comfyrunpod'))?.handle;
    const route = runPodRouter?.stack.find(layer => layer.route?.path === '/generate')?.route;
    runPodGenerateHandler = route?.stack.at(-1)?.handle;
    const zaiRouter = stableDiffusionRouter.stack.find(layer => String(layer.regexp).includes('zai'))?.handle;
    zaiVideoHandler = zaiRouter?.stack.find(layer => layer.route?.path === '/generate-video')?.route?.stack.at(-1)?.handle;
    googleVideoHandler = googleRouter.stack.find(layer => layer.route?.path === '/generate-video')?.route?.stack.at(-1)?.handle;
    openAiVideoHandler = openAiRouter.stack.find(layer => layer.route?.path === '/generate-video')?.route?.stack.at(-1)?.handle;
    if (!runPodGenerateHandler || !googleVideoHandler || !openAiVideoHandler || !zaiVideoHandler) {
        throw new Error('Request lifecycle test handler not found');
    }
});

afterEach(() => {
    fetchMock.mockReset();
    jest.restoreAllMocks();
});

function createResponse() {
    const response = new EventEmitter();
    response.writableEnded = false;
    response.status = jest.fn(() => response);
    response.send = jest.fn(value => {
        response.writableEnded = true;
        return value;
    });
    response.sendStatus = jest.fn(value => {
        response.writableEnded = true;
        return value;
    });
    return response;
}

function createRunPodRequest() {
    return {
        body: {
            url: 'https://api.runpod.ai/v2/test-endpoint',
            prompt: JSON.stringify({ prompt: {} }),
        },
        user: { directories: {} },
    };
}

async function expectVideoFetchSignals(handler, request, responses) {
    responses.forEach(fetchResponse => fetchMock.mockResolvedValueOnce(fetchResponse));
    const response = createResponse();
    const handling = handler(request, response);

    await jest.advanceTimersByTimeAsync(5000);
    await handling;

    const signals = fetchMock.mock.calls.map(([, options]) => options.signal);
    expect(signals).toHaveLength(3);
    expect(signals.every(Boolean)).toBe(true);
    expect(new Set(signals).size).toBe(1);
    fetchMock.mockReset();
}

describe('request lifecycle safety', () => {
    test('aborts an outbound request only when the client disconnects before completion', () => {
        const activeResponse = createResponse();
        const activeController = new AbortController();
        abortControllerOnClientClose(activeResponse, activeController);

        activeResponse.emit('close');

        expect(activeController.signal.aborted).toBe(true);

        const completedResponse = createResponse();
        const completedController = new AbortController();
        completedResponse.writableEnded = true;
        abortControllerOnClientClose(completedResponse, completedController);

        completedResponse.emit('close');

        expect(completedController.signal.aborted).toBe(false);
    });

    test('returns immediately when RunPod reports a terminal failure', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        for (const jobStatus of ['FAILED', 'CANCELLED', 'TIMED_OUT']) {
            fetchMock
                .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'job-1' }) })
                .mockResolvedValueOnce({ ok: true, json: async () => ({ status: jobStatus, error: 'worker failed' }) });
            const response = createResponse();

            await runPodGenerateHandler(createRunPodRequest(), response);

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(response.status).toHaveBeenCalledWith(500);
            expect(response.send).toHaveBeenCalledWith(`ComfyUI RunPod job ended with status ${jobStatus}.`);
            fetchMock.mockReset();
        }
    });

    test('continues polling while RunPod reports an active running state', async () => {
        jest.useFakeTimers();
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'job-1' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'RUNNING' }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'COMPLETED', output: { images: [{ filename: 'result.png', data: 'image-data' }] } }),
            });
        const response = createResponse();

        try {
            const handling = runPodGenerateHandler(createRunPodRequest(), response);
            await jest.advanceTimersByTimeAsync(500);
            await handling;

            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(response.send).toHaveBeenCalledWith({ format: 'png', data: 'image-data' });
        } finally {
            jest.useRealTimers();
        }
    });

    test('does not cancel an undefined RunPod job when the client disconnects before submission completes', async () => {
        let resolveSubmission;
        let submissionSignal;
        fetchMock
            .mockImplementationOnce((_url, options) => {
                submissionSignal = options.signal;
                return new Promise(resolve => {
                    resolveSubmission = resolve;
                });
            })
            .mockRejectedValueOnce(new Error('aborted'));
        const response = createResponse();
        const handling = runPodGenerateHandler(createRunPodRequest(), response);
        await Promise.resolve();

        response.emit('close');
        resolveSubmission({ ok: true, json: async () => ({ id: 'job-after-close' }) });
        await handling;

        expect(submissionSignal.aborted).toBe(true);
        expect(fetchMock.mock.calls.map(([url]) => String(url)).some(url => url.includes('/cancel/'))).toBe(false);
    });

    test('uses one abort signal for every Google, OpenAI, and Z.AI video request stage', async () => {
        jest.spyOn(console, 'debug').mockImplementation(() => {});
        jest.useFakeTimers();
        const contentResponse = { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
        let verifiedProviders = 0;

        try {
            await expectVideoFetchSignals(googleVideoHandler, {
                body: { api: 'makersuite', model: 'veo-3.1-generate-preview', prompt: 'test' },
                user: { directories: {} },
            }, [
                { ok: true, json: async () => ({ name: 'operations/google-video' }) },
                { ok: true, json: async () => ({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://video.test/google.mp4' } }] } } }) },
                contentResponse,
            ]);
            verifiedProviders++;

            await expectVideoFetchSignals(openAiVideoHandler, {
                body: { model: 'sora-2', prompt: 'test' },
                user: { directories: {} },
            }, [
                { ok: true, json: async () => ({ id: 'openai-video' }) },
                { ok: true, json: async () => ({ status: 'completed' }) },
                contentResponse,
            ]);
            verifiedProviders++;

            await expectVideoFetchSignals(zaiVideoHandler, {
                body: { model: 'cogvideox-3', prompt: 'test' },
                user: { directories: {} },
            }, [
                { ok: true, json: async () => ({ id: 'zai-video' }) },
                { ok: true, json: async () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://video.test/zai.mp4' }] }) },
                contentResponse,
            ]);
            verifiedProviders++;
            expect(verifiedProviders).toBe(3);
        } finally {
            jest.useRealTimers();
        }
    });

    test('does not write an error response after a video client disconnects', async () => {
        fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }));
        const response = createResponse();
        const handling = openAiVideoHandler({
            body: { model: 'sora-2', prompt: 'test' },
            user: { directories: {} },
        }, response);
        await Promise.resolve();

        response.emit('close');
        await handling;

        expect(response.status).not.toHaveBeenCalled();
        expect(response.sendStatus).not.toHaveBeenCalled();
        expect(response.send).not.toHaveBeenCalled();
    });
});

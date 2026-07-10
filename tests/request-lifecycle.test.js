import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();
const secretValues = new Map();
const hordeClientMocks = {
    postAsyncImageGenerate: jest.fn(),
    getImageGenerationCheck: jest.fn(),
    getImageGenerationStatus: jest.fn(),
    deleteImageGenerationRequest: jest.fn(),
};

jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
jest.unstable_mockModule('simple-git', () => ({
    default: () => ({
        revparse: async () => 'test-revision',
        show: async () => '2026-01-01 00:00:00 +0000',
    }),
}));
jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({
    readSecret: (_directories, key) => secretValues.get(key) ?? 'test-secret',
    SECRET_KEYS: {
        COMFY_RUNPOD: 'api_key_comfy_runpod',
        HORDE: 'api_key_horde',
        MAKERSUITE: 'api_key_makersuite',
        OPENAI: 'api_key_openai',
        OPENROUTER: 'api_key_openrouter',
        VERTEXAI: 'api_key_vertexai',
        VERTEXAI_SERVICE_ACCOUNT: 'vertexai_service_account_json',
        ZAI: 'api_key_zai',
    },
}));
jest.unstable_mockModule('@zeldafan0225/ai_horde', () => ({
    AIHorde: class {
        postAsyncImageGenerate(...args) {
            return hordeClientMocks.postAsyncImageGenerate(...args);
        }

        getImageGenerationCheck(...args) {
            return hordeClientMocks.getImageGenerationCheck(...args);
        }

        getImageGenerationStatus(...args) {
            return hordeClientMocks.getImageGenerationStatus(...args);
        }

        deleteImageGenerationRequest(...args) {
            return hordeClientMocks.deleteImageGenerationRequest(...args);
        }
    },
    ModelGenerationInputStableSamplers: { k_euler: 'k_euler' },
    ModelInterrogationFormTypes: { caption: 'caption' },
    HordeAsyncRequestStates: { done: 'done', faulted: 'faulted', cancelled: 'cancelled' },
}));

let abortControllerOnClientClose;
let setConfigFilePath;
let runPodGenerateHandler;
let sdWebUiGenerateHandler;
let hordeGenerateHandler;
let chatCompletionGenerateHandler;
let googleVideoHandler;
let openAiVideoHandler;
let zaiVideoHandler;

beforeAll(async () => {
    ({ abortControllerOnClientClose, setConfigFilePath } = await import('../src/util.js'));
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const [
        { router: stableDiffusionRouter },
        { router: googleRouter },
        { router: openAiRouter },
        { router: hordeRouter },
        { router: chatCompletionRouter },
    ] = await Promise.all([
        import('../src/endpoints/stable-diffusion.js'),
        import('../src/endpoints/google.js'),
        import('../src/endpoints/openai.js'),
        import('../src/endpoints/horde.js'),
        import('../src/endpoints/backends/chat-completions.js'),
    ]);
    const runPodRouter = stableDiffusionRouter.stack.find(layer => String(layer.regexp).includes('comfyrunpod'))?.handle;
    const route = runPodRouter?.stack.find(layer => layer.route?.path === '/generate')?.route;
    runPodGenerateHandler = route?.stack.at(-1)?.handle;
    sdWebUiGenerateHandler = stableDiffusionRouter.stack.find(layer => layer.route?.path === '/generate')?.route?.stack.at(-1)?.handle;
    hordeGenerateHandler = hordeRouter.stack.find(layer => layer.route?.path === '/generate-image')?.route?.stack.at(-1)?.handle;
    chatCompletionGenerateHandler = chatCompletionRouter.stack.find(layer => layer.route?.path === '/generate')?.route?.stack.at(-1)?.handle;
    const zaiRouter = stableDiffusionRouter.stack.find(layer => String(layer.regexp).includes('zai'))?.handle;
    zaiVideoHandler = zaiRouter?.stack.find(layer => layer.route?.path === '/generate-video')?.route?.stack.at(-1)?.handle;
    googleVideoHandler = googleRouter.stack.find(layer => layer.route?.path === '/generate-video')?.route?.stack.at(-1)?.handle;
    openAiVideoHandler = openAiRouter.stack.find(layer => layer.route?.path === '/generate-video')?.route?.stack.at(-1)?.handle;
    if (!runPodGenerateHandler || !sdWebUiGenerateHandler || !hordeGenerateHandler || !chatCompletionGenerateHandler || !googleVideoHandler || !openAiVideoHandler || !zaiVideoHandler) {
        throw new Error('Request lifecycle test handler not found');
    }
});

afterEach(() => {
    fetchMock.mockReset();
    secretValues.clear();
    Object.values(hordeClientMocks).forEach(mock => mock.mockReset());
    jest.restoreAllMocks();
});

function createResponse() {
    const response = new EventEmitter();
    response.headersSent = false;
    response.writableEnded = false;
    response.status = jest.fn(() => response);
    response.send = jest.fn(value => {
        response.headersSent = true;
        response.writableEnded = true;
        return value;
    });
    response.sendStatus = jest.fn(value => {
        response.headersSent = true;
        response.writableEnded = true;
        return value;
    });
    return response;
}

function createHordeRequest() {
    return {
        body: {
            prompt: 'test prompt',
            negative_prompt: '',
            sampler: 'k_euler',
            enable_hr: false,
            restore_faces: false,
            scale: 7,
            steps: 20,
            width: 512,
            height: 512,
            karras: false,
            clip_skip: 1,
            seed: -1,
            nfsw: false,
            model: 'test-model',
        },
        user: { directories: {} },
    };
}

function getServiceAccountJson() {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return JSON.stringify({
        client_email: 'test@example.invalid',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        project_id: 'test-project',
    });
}

async function waitForMockCall(mock, count = 1) {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (mock.mock.calls.length >= count) {
            return;
        }
        await Promise.resolve();
    }
    throw new Error(`Mock was not called ${count} time(s)`);
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

    test('does not start SD WebUI generation when the client disconnects during options lookup', async () => {
        let optionsSignal;
        fetchMock.mockImplementationOnce((_url, options) => {
            optionsSignal = options.signal;
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            });
        });
        const response = createResponse();
        const handling = sdWebUiGenerateHandler({ body: { url: 'https://sd-webui.test', auth: '' } }, response);
        await waitForMockCall(fetchMock);

        response.emit('close');
        await handling;

        expect(optionsSignal.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.send).not.toHaveBeenCalled();
        expect(response.sendStatus).not.toHaveBeenCalled();
    });

    test('interrupts SD WebUI only after generation has started', async () => {
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ forge_preset: 'test' }) })
            .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            }))
            .mockResolvedValueOnce({ ok: true });
        const response = createResponse();
        const handling = sdWebUiGenerateHandler({ body: { url: 'https://sd-webui.test', auth: '', prompt: 'test' } }, response);
        await waitForMockCall(fetchMock, 2);

        response.emit('close');
        await handling;
        await waitForMockCall(fetchMock, 3);

        expect(String(fetchMock.mock.calls[2][0])).toBe('https://sd-webui.test/sdapi/v1/interrupt');
        expect(response.sendStatus).not.toHaveBeenCalled();
    });

    test('does not interrupt SD WebUI after the txt2img request has settled', async () => {
        let rejectBody;
        const body = new Promise((_resolve, reject) => {
            rejectBody = reject;
        });
        const readBody = jest.fn(() => body);
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ forge_preset: 'test' }) })
            .mockResolvedValueOnce({ ok: true, json: readBody });
        const response = createResponse();
        const handling = sdWebUiGenerateHandler({ body: { url: 'https://sd-webui.test', auth: '', prompt: 'test' } }, response);
        await waitForMockCall(readBody);

        response.emit('close');
        rejectBody(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        await handling;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/sdapi/v1/interrupt'))).toBe(false);
        expect(response.sendStatus).not.toHaveBeenCalled();
    });

    test('cancels a Horde generation that is accepted after the client disconnects', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        let resolveSubmission;
        hordeClientMocks.postAsyncImageGenerate.mockImplementationOnce(() => new Promise(resolve => {
            resolveSubmission = resolve;
        }));
        hordeClientMocks.deleteImageGenerationRequest.mockResolvedValueOnce({});
        const response = createResponse();
        const handling = hordeGenerateHandler(createHordeRequest(), response);
        await waitForMockCall(hordeClientMocks.postAsyncImageGenerate);

        response.emit('close');
        resolveSubmission({ id: 'horde-after-close' });
        await handling;
        await waitForMockCall(hordeClientMocks.deleteImageGenerationRequest);

        expect(hordeClientMocks.deleteImageGenerationRequest).toHaveBeenCalledTimes(1);
        expect(hordeClientMocks.deleteImageGenerationRequest).toHaveBeenCalledWith('horde-after-close');
        expect(hordeClientMocks.getImageGenerationCheck).not.toHaveBeenCalled();
        expect(response.sendStatus).not.toHaveBeenCalled();
    });

    test('does not cancel a successfully completed Horde generation', async () => {
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.useFakeTimers();
        hordeClientMocks.postAsyncImageGenerate.mockResolvedValueOnce({ id: 'horde-success' });
        hordeClientMocks.getImageGenerationCheck.mockResolvedValueOnce({ done: true });
        hordeClientMocks.getImageGenerationStatus.mockResolvedValueOnce({ generations: [{ img: 'image-data' }] });
        const response = createResponse();

        try {
            const handling = hordeGenerateHandler(createHordeRequest(), response);
            await jest.advanceTimersByTimeAsync(3000);
            await handling;

            expect(response.send).toHaveBeenCalledWith('image-data');
            expect(hordeClientMocks.deleteImageGenerationRequest).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    test('cancels a Horde generation when local polling times out', async () => {
        jest.spyOn(console, 'info').mockImplementation(() => {});
        jest.useFakeTimers();
        hordeClientMocks.postAsyncImageGenerate.mockResolvedValueOnce({ id: 'horde-timeout' });
        hordeClientMocks.getImageGenerationCheck.mockResolvedValue({ done: false, faulted: false });
        hordeClientMocks.deleteImageGenerationRequest.mockResolvedValueOnce({});
        const response = createResponse();

        try {
            const handling = hordeGenerateHandler(createHordeRequest(), response);
            await jest.runAllTimersAsync();
            await handling;
            await waitForMockCall(hordeClientMocks.deleteImageGenerationRequest);

            expect(hordeClientMocks.getImageGenerationCheck).toHaveBeenCalledTimes(200);
            expect(response.sendStatus).toHaveBeenCalledWith(504);
            expect(hordeClientMocks.deleteImageGenerationRequest).toHaveBeenCalledTimes(1);
            expect(hordeClientMocks.deleteImageGenerationRequest).toHaveBeenCalledWith('horde-timeout');
        } finally {
            jest.useRealTimers();
        }
    });

    test('cancels a Horde generation when polling fails', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.useFakeTimers();
        hordeClientMocks.postAsyncImageGenerate.mockResolvedValueOnce({ id: 'horde-error' });
        hordeClientMocks.getImageGenerationCheck.mockRejectedValueOnce(new Error('poll failed'));
        hordeClientMocks.deleteImageGenerationRequest.mockResolvedValueOnce({});
        const response = createResponse();

        try {
            const handling = hordeGenerateHandler(createHordeRequest(), response);
            await jest.advanceTimersByTimeAsync(3000);
            await handling;
            await waitForMockCall(hordeClientMocks.deleteImageGenerationRequest);

            expect(response.sendStatus).toHaveBeenCalledWith(500);
            expect(hordeClientMocks.deleteImageGenerationRequest).toHaveBeenCalledTimes(1);
            expect(hordeClientMocks.deleteImageGenerationRequest).toHaveBeenCalledWith('horde-error');
        } finally {
            jest.useRealTimers();
        }
    });

    test('aborts OpenRouter model lookup before sending generation after disconnect', async () => {
        let lookupSignal;
        fetchMock.mockImplementationOnce((_url, options) => {
            lookupSignal = options.signal;
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            });
        });
        const response = createResponse();
        const handling = chatCompletionGenerateHandler({
            body: {
                chat_completion_source: 'openrouter',
                model: 'google/gemini-lifecycle-test',
                messages: [{ role: 'user', content: 'test' }],
                stream: false,
            },
            user: { directories: {} },
        }, response);
        await waitForMockCall(fetchMock);

        response.emit('close');
        await handling;

        expect(lookupSignal.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.send).not.toHaveBeenCalled();
        expect(response.sendStatus).not.toHaveBeenCalled();
    });

    test('aborts Vertex AI service-account authentication before generation after disconnect', async () => {
        secretValues.set('vertexai_service_account_json', getServiceAccountJson());
        let authSignal;
        fetchMock.mockImplementationOnce((_url, options) => {
            authSignal = options.signal;
            return new Promise((_resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            });
        });
        const response = createResponse();
        const handling = chatCompletionGenerateHandler({
            body: {
                chat_completion_source: 'vertexai',
                vertexai_auth_mode: 'full',
                model: 'gemini-2.5-flash',
                messages: [{ role: 'user', content: 'test' }],
                stream: false,
            },
            user: { directories: {} },
        }, response);
        await waitForMockCall(fetchMock);

        response.emit('close');
        await handling;

        expect(authSignal.aborted).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(response.status).not.toHaveBeenCalled();
        expect(response.send).not.toHaveBeenCalled();
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

    test('uses the video abort signal for Vertex AI authentication and polling', async () => {
        secretValues.set('vertexai_service_account_json', getServiceAccountJson());
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'vertex-token' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'operations/vertex-video' }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'vertex-token' }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ done: true, response: { videos: [{ bytesBase64Encoded: 'video-data' }] } }),
            });
        const response = createResponse();
        jest.useFakeTimers();

        try {
            const handling = googleVideoHandler({
                body: {
                    api: 'vertexai',
                    vertexai_auth_mode: 'full',
                    vertexai_region: 'us-central1',
                    model: 'veo-3.1-generate-preview',
                    prompt: 'test',
                },
                user: { directories: {} },
            }, response);
            await jest.advanceTimersByTimeAsync(5000);
            await handling;

            const signals = fetchMock.mock.calls.map(([, options]) => options.signal);
            expect(signals).toHaveLength(4);
            expect(signals.every(Boolean)).toBe(true);
            expect(new Set(signals).size).toBe(1);
            expect(response.send).toHaveBeenCalledWith({ video: 'video-data' });
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

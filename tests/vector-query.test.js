import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const queryItems = jest.fn();

jest.unstable_mockModule('vectra', () => ({
    default: {
        LocalIndex: jest.fn(() => ({
            isIndexCreated: jest.fn().mockResolvedValue(true),
            queryItems,
        })),
    },
}));

jest.unstable_mockModule('../src/util.js', () => ({
    getConfigValue: jest.fn((_key, defaultValue) => defaultValue),
}));

jest.unstable_mockModule('../src/vectors/nomicai-vectors.js', () => ({
    getNomicAIBatchVector: jest.fn(),
    getNomicAIVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/openai-vectors.js', () => ({
    getOpenAIBatchVector: jest.fn(),
    getOpenAIVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/embedding.js', () => ({
    getTransformersBatchVector: jest.fn(),
    getTransformersVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/extras-vectors.js', () => ({
    getExtrasBatchVector: jest.fn(),
    getExtrasVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/google-vectors.js', () => ({
    getMakerSuiteBatchVector: jest.fn(),
    getMakerSuiteVector: jest.fn(),
    getVertexBatchVector: jest.fn(),
    getVertexVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/cohere-vectors.js', () => ({
    getCohereBatchVector: jest.fn(),
    getCohereVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/llamacpp-vectors.js', () => ({
    getLlamaCppBatchVector: jest.fn(),
    getLlamaCppVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/vllm-vectors.js', () => ({
    getVllmBatchVector: jest.fn(),
    getVllmVector: jest.fn(),
}));

jest.unstable_mockModule('../src/vectors/ollama-vectors.js', () => ({
    getOllamaBatchVector: jest.fn(),
    getOllamaVector: jest.fn(),
}));

let queryHandler;

beforeAll(async () => {
    const { router } = await import('../src/endpoints/vectors.js');
    queryHandler = router.stack.find(layer => layer.route?.path === '/query').route.stack[0].handle;
});

beforeEach(() => {
    queryItems.mockReset();
});

describe('vector query', () => {
    test('applies the similarity threshold to both metadata and hashes', async () => {
        queryItems.mockResolvedValue([
            { score: 0.9, item: { metadata: { hash: '101', text: 'included' } } },
            { score: 0.4, item: { metadata: { hash: '202', text: 'excluded' } } },
        ]);
        const request = {
            body: {
                collectionId: 'chat',
                searchText: 'search',
                topK: 10,
                threshold: 0.8,
                source: 'webllm',
                embeddings: { search: [1, 0] },
            },
            user: { directories: { vectors: '/tmp/vectors' } },
        };
        const response = {
            json: jest.fn(value => value),
            sendStatus: jest.fn(),
        };

        await queryHandler(request, response);

        expect(response.sendStatus).not.toHaveBeenCalled();
        expect(response.json).toHaveBeenCalledWith({
            metadata: [{ hash: '101', text: 'included' }],
            hashes: [101],
        });
    });
});

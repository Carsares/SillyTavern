import { parentPort, workerData } from 'node:worker_threads';
import { dirname, basename, join } from 'node:path';
import { createRequire } from 'node:module';

// No legacy module/config imports and no model download or shared cache mutation.
try {
    const { pipeline, env } = await import('sillytavern-transformers');
    const require = createRequire(import.meta.url);
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.useFSCache = false; env.useBrowserCache = false;
    env.localModelPath = dirname(workerData.modelPath);
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.wasmPaths = join(dirname(require.resolve('sillytavern-transformers/package.json')), 'dist') + '/';
    const extractor = await pipeline('feature-extraction', basename(workerData.modelPath), { local_files_only: true });
    let embeddings;
    try { const tensor = await extractor(workerData.texts, { pooling: 'mean', normalize: true }); embeddings = tensor.tolist(); }
    finally { await extractor.dispose(); }
    parentPort.postMessage({ embeddings });
} catch { parentPort.postMessage({ error: true }); }

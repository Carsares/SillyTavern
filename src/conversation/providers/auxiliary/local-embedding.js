import { Worker } from 'node:worker_threads';
import { fail } from '../core/index.js';
import { integer } from './common.js';

/** Own worker isolates library environment/cache settings and permits actual cancellation. */
export async function localEmbeddings(c, texts, signal, workerFactory = (url, options) => new Worker(url, options)) {
    const timeout = integer(c.localTimeoutMs ?? 120000, 'localTimeoutMs', 1, 600000);
    const effective = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    effective.throwIfAborted();
    const worker = workerFactory(new URL('./local-worker.js', import.meta.url), { workerData: { modelPath: c.localModelPath, texts },
        env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let abort;
    try {
        return await new Promise((resolve, reject) => {
            abort = () => reject(fail('aborted', 'Local embedding inference stopped'));
            effective.addEventListener('abort', abort, { once: true });
            worker.once('error', () => reject(fail('local-inference-failed', 'Local embedding runtime failed')));
            worker.once('exit', () => reject(fail('local-inference-failed', 'Local embedding runtime ended without a result')));
            worker.once('message', message => message.error ? reject(fail('local-inference-failed', 'Local model loading or inference failed')) : resolve(message.embeddings));
            if (effective.aborted) abort();
        });
    } finally { effective.removeEventListener('abort', abort); await worker.terminate(); }
}

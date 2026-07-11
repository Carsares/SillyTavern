/**
 * Serializes asynchronous operations independently for each key.
 * Mirrors src/keyed-promise-queue.js for the modern frontend.
 */
export class KeyedPromiseQueue {
    #operations = new Map();

    async run(key, operation) {
        const previousOperation = this.#operations.get(key) ?? Promise.resolve();
        const currentOperation = previousOperation.catch(() => {}).then(operation);
        this.#operations.set(key, currentOperation);
        try {
            return await currentOperation;
        } finally {
            if (this.#operations.get(key) === currentOperation) {
                this.#operations.delete(key);
            }
        }
    }
}

/** Serializes tasks in invocation order, staying usable after failures. Mirrors save-coordinator.js. */
export class SerialTaskQueue {
    #tail = Promise.resolve();
    enqueue(task) {
        const result = this.#tail.then(task, task);
        this.#tail = result.catch(() => {});
        return result;
    }
}

// Shared serial queue so concurrent modern settings writes reach the backend in order (no reorder-induced lost update).
const settingsSaveQueue = new SerialTaskQueue();

/**
 * Serializes /api/settings/save calls across the modern UI.
 * @param {(path: string, options: object) => Promise<any>} apiFetch
 * @param {object} body Settings payload to persist
 */
export function saveSettingsSerialized(apiFetch, body) {
    return settingsSaveQueue.enqueue(() => apiFetch('/api/settings/save', { body }));
}

/**
 * Serializes asynchronous operations independently for each key.
 */
export class KeyedPromiseQueue {
    /** @type {Map<string, Promise<unknown>>} */
    #operations = new Map();

    /**
     * Queues an operation after the current operation for the same key.
     * @template T
     * @param {string} key Queue key
     * @param {() => Promise<T> | T} operation Operation to execute
     * @returns {Promise<T>} Operation result
     */
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

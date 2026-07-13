/**
 * Serializes asynchronous tasks in invocation order while keeping the queue usable after failures.
 */
export class SerialTaskQueue {
    #tail = Promise.resolve(true);
    #pendingTaskCount = 0;

    /** @returns {boolean} Whether the queue has work that is queued or executing */
    get hasPendingTasks() {
        return this.#pendingTaskCount > 0;
    }

    /**
     * Adds a task to the queue.
     * @template T
     * @param {() => Promise<T> | T} task Task to execute
     * @returns {Promise<T>} Result of the task
     */
    enqueue(task) {
        this.#pendingTaskCount++;
        const execute = async () => {
            try {
                return await task();
            } finally {
                this.#pendingTaskCount--;
            }
        };
        const result = this.#tail.then(execute, execute);
        this.#tail = result.catch(() => false);
        return result;
    }

    /**
     * Waits for the currently queued work to settle.
     * @returns {Promise<unknown>}
     */
    wait() {
        return this.#tail;
    }
}

/**
 * Stores isolated latest snapshots and applies updates atomically against the newest accepted value.
 */
export class LatestSnapshotRegistry {
    /** @type {Map<string, unknown>} */
    #snapshots = new Map();

    /** @type {<T>(value: T) => T} */
    #clone;

    /**
     * @param {<T>(value: T) => T} clone Snapshot clone function
     */
    constructor(clone = structuredClone) {
        this.#clone = clone;
    }

    /**
     * Records an accepted snapshot.
     * @template T
     * @param {string} key Snapshot key
     * @param {T} value Snapshot value
     * @returns {T} Isolated accepted snapshot
     */
    accept(key, value) {
        const snapshot = this.#clone(value);
        this.#snapshots.set(key, snapshot);
        return this.#clone(snapshot);
    }

    /**
     * Gets an isolated copy of the latest snapshot.
     * @template T
     * @param {string} key Snapshot key
     * @returns {T|undefined} Latest snapshot
     */
    get(key) {
        const snapshot = this.#snapshots.get(key);
        return snapshot === undefined ? undefined : this.#clone(snapshot);
    }

    /**
     * Updates a clone of the latest snapshot, falling back to the supplied value.
     * If the updater throws, the registry remains unchanged.
     * @template T
     * @param {string} key Snapshot key
     * @param {T} fallback Fallback snapshot when the key has not been accepted
     * @param {(value: T) => void} updater Atomic snapshot updater
     * @returns {T} Updated isolated snapshot
     */
    update(key, fallback, updater) {
        const snapshot = this.get(key) ?? this.#clone(fallback);
        updater(snapshot);
        return this.accept(key, snapshot);
    }
}

/**
 * Coordinates independently debounced and serialized tasks by key.
 */
export class KeyedTaskCoordinator {
    /** @type {Map<string, {blocked: boolean, task: (() => Promise<unknown> | unknown) | null, timer: ReturnType<typeof setTimeout> | null, queue: SerialTaskQueue}>} */
    #states = new Map();

    /** @type {number} */
    #delay;

    /** @type {(error: unknown, key: string) => void} */
    #onError;

    /**
     * @param {number} delay Debounce delay in milliseconds
     * @param {(error: unknown, key: string) => void} [onError] Delayed task error handler
     */
    constructor(delay, onError = (error) => console.error(error)) {
        this.#delay = delay;
        this.#onError = onError;
    }

    /**
     * @param {string} key Task key
     */
    #getState(key) {
        let state = this.#states.get(key);
        if (!state) {
            state = { blocked: false, task: null, timer: null, queue: new SerialTaskQueue() };
            this.#states.set(key, state);
        }
        return state;
    }

    /**
     * Schedules the latest task for a key.
     * @param {string} key Task key
     * @param {() => Promise<unknown> | unknown} task Task to execute
     * @returns {boolean} Whether the task was accepted
     */
    schedule(key, task) {
        const state = this.#getState(key);
        if (state.blocked) {
            return false;
        }

        if (state.timer) {
            clearTimeout(state.timer);
        }
        state.task = task;
        state.timer = setTimeout(() => {
            state.timer = null;
            const pendingTask = state.task;
            state.task = null;
            if (pendingTask) {
                state.queue.enqueue(pendingTask).catch(error => this.#onError(error, key));
            }
        }, this.#delay);
        return true;
    }

    /**
     * Immediately queues a task for a key.
     * @param {string} key Task key
     * @param {() => Promise<unknown> | unknown} task Task to execute
     * @param {object} [options] Options
     * @param {boolean} [options.allowBlocked=false] Whether a blocked key can accept the task
     * @returns {Promise<unknown>}
     */
    enqueue(key, task, { allowBlocked = false } = {}) {
        const state = this.#getState(key);
        if (state.blocked && !allowBlocked) {
            return Promise.reject(new Error(`Task key is blocked: ${key}`));
        }
        return state.queue.enqueue(task);
    }

    /**
     * Queues the pending debounced task and waits for all work for a key.
     * Existing pending work is flushed even when the key is blocked.
     * @param {string} key Task key
     * @returns {Promise<unknown>}
     */
    async flush(key) {
        const state = this.#getState(key);
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        const pendingTask = state.task;
        state.task = null;
        if (pendingTask) {
            await state.queue.enqueue(pendingTask);
        }
        return await state.queue.wait();
    }

    /**
     * Cancels only the not-yet-queued task for a key.
     * @param {string} key Task key
     */
    cancel(key) {
        const state = this.#states.get(key);
        if (!state) {
            return;
        }
        if (state.timer) {
            clearTimeout(state.timer);
        }
        state.timer = null;
        state.task = null;
    }

    /**
     * Prevents a key from accepting new work without discarding already pending work.
     * @param {string} key Task key
     */
    block(key) {
        this.#getState(key).blocked = true;
    }

    /**
     * Allows a key to accept work again.
     * @param {string} key Task key
     */
    unblock(key) {
        this.#getState(key).blocked = false;
    }

    /**
     * @param {string} key Task key
     * @returns {boolean} Whether the key is blocked
     */
    isBlocked(key) {
        return this.#states.get(key)?.blocked ?? false;
    }
}

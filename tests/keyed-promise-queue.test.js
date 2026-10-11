import { describe, expect, jest, test } from '@jest/globals';

import { KeyedPromiseQueue } from '../src/keyed-promise-queue.js';

describe('keyed promise queue', () => {
    test('serializes matching keys while allowing different keys to run independently', async () => {
        const queue = new KeyedPromiseQueue();
        const events = [];
        let releaseFirst;
        const firstBarrier = new Promise(resolve => {
            releaseFirst = resolve;
        });

        const first = queue.run('same', async () => {
            events.push('first:start');
            await firstBarrier;
            events.push('first:end');
        });
        const second = queue.run('same', async () => {
            events.push('second');
        });
        const independent = queue.run('other', async () => {
            events.push('other');
        });

        await independent;
        expect(events).toEqual(['first:start', 'other']);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).toEqual(['first:start', 'other', 'first:end', 'second']);
    });

    test('continues after a rejected operation', async () => {
        const queue = new KeyedPromiseQueue();
        const callback = jest.fn();

        await expect(queue.run('key', async () => {
            throw new Error('failed');
        })).rejects.toThrow('failed');
        await queue.run('key', callback);

        expect(callback).toHaveBeenCalledTimes(1);
    });
});

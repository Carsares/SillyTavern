import { describe, expect, jest, test } from '@jest/globals';

import { KeyedTaskCoordinator, LatestSnapshotRegistry, SerialTaskQueue } from '../public/scripts/save-coordinator.js';

describe('save coordinators', () => {
    test('serial task queue preserves invocation order after a rejection', async () => {
        const queue = new SerialTaskQueue();
        const order = [];
        const first = queue.enqueue(async () => {
            order.push('first');
            throw new Error('failed');
        });
        const second = queue.enqueue(async () => {
            order.push('second');
            return true;
        });

        await expect(first).rejects.toThrow('failed');
        await expect(second).resolves.toBe(true);
        expect(order).toEqual(['first', 'second']);
    });

    test('serial task queue reports queued and executing work as pending', async () => {
        const queue = new SerialTaskQueue();
        let releaseFirst;
        let releaseSecond;
        const first = queue.enqueue(() => new Promise(resolve => { releaseFirst = resolve; }));
        const second = queue.enqueue(() => new Promise(resolve => { releaseSecond = resolve; }));

        expect(queue.hasPendingTasks).toBe(true);
        await Promise.resolve();
        releaseFirst();
        await first;
        expect(queue.hasPendingTasks).toBe(true);

        await Promise.resolve();
        releaseSecond();
        await second;
        expect(queue.hasPendingTasks).toBe(false);
    });

    test('latest snapshot update preserves newer data when given a stale fallback', () => {
        const registry = new LatestSnapshotRegistry(value => JSON.parse(JSON.stringify(value)));
        const stale = { chatData: ['old'], metadata: { attachments: ['old-file'] } };
        registry.accept('chat-a', { chatData: ['latest'], metadata: { attachments: ['old-file'], note: 'latest-note' } });

        const updated = registry.update('chat-a', stale, context => {
            context.metadata.attachments = [];
        });

        expect(updated).toEqual({ chatData: ['latest'], metadata: { attachments: [], note: 'latest-note' } });
        stale.chatData.push('mutated-fallback');
        expect(registry.get('chat-a')).toEqual(updated);
    });

    test('latest snapshot update is atomic when the updater fails', () => {
        const registry = new LatestSnapshotRegistry(value => JSON.parse(JSON.stringify(value)));
        const accepted = { chatData: ['latest'], metadata: { attachments: ['file'] } };
        registry.accept('chat-a', accepted);

        expect(() => registry.update('chat-a', accepted, context => {
            context.metadata.attachments = [];
            throw new Error('update failed');
        })).toThrow('update failed');
        expect(registry.get('chat-a')).toEqual(accepted);
    });

    test('compensating update rolls back one field without reverting a newer snapshot', () => {
        const registry = new LatestSnapshotRegistry(value => JSON.parse(JSON.stringify(value)));
        const original = { chatData: ['old'], metadata: { attachments: ['file'], note: 'old-note' } };
        registry.accept('chat-a', original);
        registry.update('chat-a', original, context => { context.metadata.attachments = []; });
        registry.accept('chat-a', { chatData: ['new-message'], metadata: { attachments: [], note: 'new-note' } });

        const rolledBack = registry.update('chat-a', original, context => { context.metadata.attachments = ['file']; });

        expect(rolledBack).toEqual({ chatData: ['new-message'], metadata: { attachments: ['file'], note: 'new-note' } });
    });

    test('keyed coordinator flushes only the latest task and serializes it after active work', async () => {
        jest.useFakeTimers();
        const coordinator = new KeyedTaskCoordinator(100);
        const order = [];
        let releaseActive;
        const active = coordinator.enqueue('group-a', async () => {
            order.push('active');
            await new Promise(resolve => { releaseActive = resolve; });
            order.push('active-done');
        });

        coordinator.schedule('group-a', async () => order.push('stale'));
        coordinator.schedule('group-a', async () => order.push('latest'));
        const flushed = coordinator.flush('group-a');
        await Promise.resolve();
        expect(order).toEqual(['active']);
        releaseActive();
        await active;
        await flushed;
        expect(order).toEqual(['active', 'active-done', 'latest']);
        jest.useRealTimers();
    });

    test('keyed coordinator reports debounced and in-flight work as pending', async () => {
        jest.useFakeTimers();
        const coordinator = new KeyedTaskCoordinator(100);
        expect(coordinator.hasPendingTasks).toBe(false);

        // A scheduled-but-not-yet-fired debounced task counts as pending
        coordinator.schedule('group-a', async () => {});
        expect(coordinator.hasPendingTasks).toBe(true);

        // After the debounce fires, the queued execution still counts as pending until it settles
        let releaseWork;
        coordinator.schedule('group-b', () => new Promise(resolve => { releaseWork = resolve; }));
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        expect(coordinator.hasPendingTasks).toBe(true);

        jest.useRealTimers();
        releaseWork();
        await coordinator.flush('group-b');
        await coordinator.flush('group-a');
        expect(coordinator.hasPendingTasks).toBe(false);
    });

    test('blocking rejects new work but still flushes work scheduled before deletion', async () => {
        jest.useFakeTimers();
        const coordinator = new KeyedTaskCoordinator(100);
        const saved = [];
        coordinator.schedule('group-a', async () => saved.push('old-write'));
        coordinator.block('group-a');

        expect(coordinator.schedule('group-a', async () => saved.push('late-write'))).toBe(false);
        await coordinator.flush('group-a');
        await expect(coordinator.enqueue('group-a', async () => saved.push('new-write'))).rejects.toThrow('blocked');
        expect(saved).toEqual(['old-write']);

        coordinator.unblock('group-a');
        await coordinator.enqueue('group-a', async () => saved.push('retry-write'));
        expect(saved).toEqual(['old-write', 'retry-write']);
        jest.useRealTimers();
    });
});

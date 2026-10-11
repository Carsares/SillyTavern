import { afterEach, describe, expect, jest, test } from '@jest/globals';

import {
    createKeyedDebouncer,
    createWorldInfoDeleteBarrier,
    needsEmbeddedWorldInfoConfirmation,
    removeWorldInfoFromCharLore,
    replaceWorldInfoInPersonaDescriptions,
    replaceWorldInfoInSelectedWorlds,
    tryCreateWorldInfo,
} from '../public/scripts/world-info-file-helpers.js';

afterEach(() => {
    jest.useRealTimers();
});

describe('world info file helpers', () => {
    test('debounces independently by key and keeps the latest arguments for each key', () => {
        jest.useFakeTimers();
        const callback = jest.fn();
        const errorHandler = jest.fn();
        const debouncer = createKeyedDebouncer(callback, errorHandler, 100);

        debouncer.schedule('first', 1);
        debouncer.schedule('second', 2);
        debouncer.schedule('first', 3);
        jest.advanceTimersByTime(100);

        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenCalledWith('first', 3);
        expect(callback).toHaveBeenCalledWith('second', 2);
        expect(errorHandler).not.toHaveBeenCalled();
    });

    test('cancels only the requested key', () => {
        jest.useFakeTimers();
        const callback = jest.fn();
        const debouncer = createKeyedDebouncer(callback, jest.fn(), 100);

        debouncer.schedule('first');
        debouncer.schedule('second');
        expect(debouncer.cancel('first')).toBe(true);
        jest.advanceTimersByTime(100);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('second');
    });

    test('flushes only the requested key immediately', async () => {
        jest.useFakeTimers();
        const callback = jest.fn();
        const debouncer = createKeyedDebouncer(callback, jest.fn(), 100);

        debouncer.schedule('first', 1);
        debouncer.schedule('second', 2);
        await debouncer.flush('first');

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('first', 1);
        jest.advanceTimersByTime(100);
        expect(callback).toHaveBeenCalledWith('second', 2);
    });

    test('routes rejected callbacks to the error handler', async () => {
        jest.useFakeTimers();
        const error = new Error('save failed');
        const errorHandler = jest.fn();
        const debouncer = createKeyedDebouncer(jest.fn().mockRejectedValue(error), errorHandler, 100);

        debouncer.schedule('world', 'data');
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();

        expect(errorHandler).toHaveBeenCalledWith(error, 'world', 'data');
    });

    test('blocks new saves throughout deletion and restores them only after an explicit recreation', () => {
        const barrier = createWorldInfoDeleteBarrier();

        expect(barrier.beginDelete('World')).toBe(true);
        expect(barrier.beginDelete('World')).toBe(false);
        expect(barrier.canSave('World')).toBe(false);
        expect(barrier.canSave('World', true)).toBe(false);

        barrier.markDeleted('World');
        expect(barrier.canSave('World')).toBe(false);
        expect(barrier.canSave('World', true)).toBe(true);

        barrier.restore('World');
        expect(barrier.canSave('World')).toBe(true);
    });

    test('unblocks saves when deletion fails', () => {
        const barrier = createWorldInfoDeleteBarrier();

        barrier.beginDelete('World');
        barrier.cancelDelete('World');

        expect(barrier.canSave('World')).toBe(true);
    });

    test('handles create conflicts without rejecting and rethrows other failures', async () => {
        const onConflict = jest.fn();
        const conflict = Object.assign(new Error('conflict'), { status: 409 });
        const failure = new Error('failure');

        await expect(tryCreateWorldInfo(jest.fn(), onConflict)).resolves.toBe(true);
        expect(onConflict).not.toHaveBeenCalled();
        await expect(tryCreateWorldInfo(jest.fn().mockRejectedValue(conflict), onConflict)).resolves.toBe(false);
        expect(onConflict).toHaveBeenCalledTimes(1);
        await expect(tryCreateWorldInfo(jest.fn().mockRejectedValue(failure), onConflict)).rejects.toBe(failure);
    });

    test('restores a deleted name when a create conflict proves another client recreated it', async () => {
        const barrier = createWorldInfoDeleteBarrier();
        const conflict = Object.assign(new Error('conflict'), { status: 409 });
        barrier.beginDelete('World');
        barrier.markDeleted('World');

        await tryCreateWorldInfo(jest.fn().mockRejectedValue(conflict), () => barrier.restore('World'));

        expect(barrier.canSave('World')).toBe(true);
    });

    test('retargets every persona linked to a renamed World Info', () => {
        const descriptors = {
            first: { lorebook: 'Old', description: 'first' },
            second: { lorebook: 'Other', description: 'second' },
            third: { lorebook: 'Old', description: 'third' },
        };

        expect(replaceWorldInfoInPersonaDescriptions(descriptors, 'Old', 'New')).toEqual(['first', 'third']);
        expect(descriptors).toEqual({
            first: { lorebook: 'New', description: 'first' },
            second: { lorebook: 'Other', description: 'second' },
            third: { lorebook: 'New', description: 'third' },
        });
    });

    test('retargets a globally selected World Info without duplicating an existing target', () => {
        expect(replaceWorldInfoInSelectedWorlds(['First', 'Old', 'New'], 'Old', 'New')).toEqual(['First', 'New']);
    });

    test('requires an overwrite confirmation even when the generic embedded import prompt was skipped', () => {
        expect(needsEmbeddedWorldInfoConfirmation(true, 'Existing')).toBe(true);
        expect(needsEmbeddedWorldInfoConfirmation(true, undefined)).toBe(false);
        expect(needsEmbeddedWorldInfoConfirmation(false, undefined)).toBe(true);
    });

    test('cleans every consecutive auxiliary link without mutating the original records', () => {
        const charLore = [
            { name: 'first', extraBooks: ['Target'] },
            { name: 'second', extraBooks: ['Target'] },
            { name: 'third', extraBooks: ['Target', 'Keep'] },
        ];

        const result = removeWorldInfoFromCharLore(charLore, 'Target');

        expect(result).toEqual([{ name: 'third', extraBooks: ['Keep'] }]);
        expect(charLore[2].extraBooks).toEqual(['Target', 'Keep']);
    });
});

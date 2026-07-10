import { describe, expect, test } from '@jest/globals';

import {
    needsEmbeddedWorldInfoConfirmation,
    removeWorldInfoFromCharLore,
} from '../public/scripts/world-info-file-helpers.js';

describe('world info file helpers', () => {
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

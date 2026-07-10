import { describe, expect, jest, test } from '@jest/globals';

import { removeAttachmentFile, replaceAttachmentFile } from '../public/scripts/attachment-file-helpers.js';

describe('attachment file replacement', () => {
    test('keeps the original when the replacement upload fails', async () => {
        const removeOriginal = jest.fn(async () => true);

        await expect(replaceAttachmentFile(async () => undefined, removeOriginal)).resolves.toEqual({
            url: '',
            originalRemoved: false,
        });
        expect(removeOriginal).not.toHaveBeenCalled();
    });

    test('removes the original only after the replacement is available', async () => {
        const order = [];
        const result = await replaceAttachmentFile(
            async () => {
                order.push('uploaded');
                return 'files/new.txt';
            },
            async () => {
                order.push('removed');
                return true;
            },
        );

        expect(order).toEqual(['uploaded', 'removed']);
        expect(result).toEqual({ url: 'files/new.txt', originalRemoved: true });
    });

    test('reports a safe partial result when original cleanup fails', async () => {
        await expect(replaceAttachmentFile(async () => 'files/new.txt', async () => false)).resolves.toEqual({
            url: 'files/new.txt',
            originalRemoved: false,
        });
    });
});

describe('attachment file removal', () => {
    test('does not delete the physical file when reference persistence fails', async () => {
        const removeFile = jest.fn(async () => true);

        await expect(removeAttachmentFile(async () => false, removeFile)).resolves.toEqual({
            referenceRemoved: false,
            fileRemoved: false,
        });
        expect(removeFile).not.toHaveBeenCalled();
    });

    test('cleans up the physical file only after the reference is persisted', async () => {
        const order = [];

        await expect(removeAttachmentFile(
            async () => {
                order.push('reference');
                return true;
            },
            async () => {
                order.push('file');
                return true;
            },
        )).resolves.toEqual({ referenceRemoved: true, fileRemoved: true });
        expect(order).toEqual(['reference', 'file']);
    });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { zipSync } from 'fflate';
import { getImageBuffers, ImageZipLimitError } from '../src/util.js';
import { router as spritesRouter } from '../src/endpoints/sprites.js';

const tempRoots = [];
const uploadZipHandler = spritesRouter.stack.find(layer => layer.route?.path === '/upload-zip').route.stack.at(-1).handle;

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createZip(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-image-zip-'));
    const zipPath = path.join(root, 'images.zip');
    tempRoots.push(root);
    fs.writeFileSync(zipPath, zipSync(files));
    return zipPath;
}

describe('image ZIP extraction limits', () => {
    test('rejects archives with too many entries', async () => {
        const zipPath = createZip({
            'one.png': new Uint8Array([1]),
            'two.png': new Uint8Array([2]),
        });

        await expect(getImageBuffers(zipPath, { maxEntries: 1 })).rejects.toBeInstanceOf(ImageZipLimitError);
    });

    test('rejects images whose total uncompressed size exceeds the limit', async () => {
        const zipPath = createZip({
            'image.png': new Uint8Array([1, 2, 3, 4]),
        });

        await expect(getImageBuffers(zipPath, { maxTotalSize: 3 })).rejects.toBeInstanceOf(ImageZipLimitError);
    });

    test('returns images within both limits', async () => {
        const zipPath = createZip({
            'image.png': new Uint8Array([1, 2, 3, 4]),
            'notes.txt': new Uint8Array([5]),
        });

        const images = await getImageBuffers(zipPath, { maxEntries: 2, maxTotalSize: 4 });

        expect(images).toHaveLength(1);
        expect(images[0][0]).toBe('image.png');
        expect(images[0][1]).toEqual(Buffer.from([1, 2, 3, 4]));
    });

    test('returns payload too large when a sprite archive exceeds extraction limits', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const entries = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`${index}.png`, new Uint8Array([index % 256])]));
        const zipPath = createZip(entries);
        const charactersRoot = path.join(path.dirname(zipPath), 'characters');
        const response = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            send: jest.fn(function () { return this; }),
            sendStatus: jest.fn(function (code) {
                this.statusCode = code;
                return this;
            }),
        };

        await uploadZipHandler({
            body: { name: 'character' },
            file: { destination: path.dirname(zipPath), filename: path.basename(zipPath) },
            user: { directories: { characters: charactersRoot } },
        }, response);

        expect(response.statusCode).toBe(413);
        expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('1000 entries') }));
    });
});

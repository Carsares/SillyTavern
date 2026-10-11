import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { strToU8, zipSync } from 'fflate';

import { ByafParser } from '../src/byaf.js';
import { CharXParser } from '../src/charx.js';
import { extractFileFromZipBuffer, extractFilesFromZipBuffer, setConfigFilePath, ZipExtractionBudget, ZipExtractionLimitError } from '../src/util.js';

const tempRoots = [];
let importCharacterHandler;

beforeAll(async () => {
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const { router } = await import('../src/endpoints/characters.js');
    importCharacterHandler = router.stack.find(layer => layer.route?.path === '/import').route.stack.at(-1).handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createZip(files) {
    return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))));
}

function createEntryHeavyCharX() {
    const assets = Array.from({ length: 1000 }, (_, index) => ({
        type: 'background',
        name: `Background ${index}`,
        ext: 'png',
        uri: `embedded://assets/${index}.png`,
    }));
    return createZip({
        'card.json': JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: { name: 'Entry Heavy', assets },
        }),
    });
}

function createResponse() {
    const response = { statusCode: 200 };
    response.status = jest.fn(function (code) {
        this.statusCode = code;
        return this;
    });
    response.send = jest.fn(function () { return this; });
    response.sendStatus = jest.fn(function (code) {
        this.statusCode = code;
        return this;
    });
    return response;
}

describe('archive ZIP extraction limits', () => {
    test('enforces one shared byte budget across separate entry reads', async () => {
        const archive = createZip({ 'first.bin': '123', 'second.bin': '456' });
        const budget = new ZipExtractionBudget({ maxEntries: 2, maxEntrySize: 4, maxTotalSize: 5 });
        const actualSizeCheck = jest.spyOn(budget, 'assertActualSize');

        await expect(extractFileFromZipBuffer(archive, 'first.bin', { budget })).resolves.toEqual(Buffer.from('123'));
        expect(actualSizeCheck).toHaveBeenCalledWith(3);
        await expect(extractFileFromZipBuffer(archive, 'second.bin', { budget })).rejects.toBeInstanceOf(ZipExtractionLimitError);
    });

    test('rejects an oversized target set before retaining any entry buffers', async () => {
        const archive = createZip({ 'first.bin': '1', 'second.bin': '2' });
        const budget = new ZipExtractionBudget({ maxEntries: 1 });

        await expect(extractFilesFromZipBuffer(archive, ['first.bin', 'second.bin'], { budget })).rejects.toBeInstanceOf(ZipExtractionLimitError);
    });

    test('checks actual streamed bytes independently of declared entry sizes', () => {
        const budget = new ZipExtractionBudget({ maxEntrySize: 3, maxTotalSize: 3 });

        expect(() => budget.assertActualSize(4)).toThrow(ZipExtractionLimitError);
    });

    test('rejects CharX metadata that requests more entries than the shared budget', async () => {
        await expect(new CharXParser(createEntryHeavyCharX()).parse()).rejects.toBeInstanceOf(ZipExtractionLimitError);
    });

    test('rejects BYAF manifests whose referenced entries exceed the shared budget', async () => {
        const archive = createZip({
            'manifest.json': JSON.stringify({ characters: ['character.json'], scenarios: Array.from({ length: 999 }, (_, index) => `scenarios/${index}.json`) }),
            'character.json': JSON.stringify({ name: 'Entry Heavy', images: [] }),
        });

        await expect(new ByafParser(archive).parse()).rejects.toBeInstanceOf(ZipExtractionLimitError);
    });

    test('returns payload too large when a CharX import exceeds extraction limits', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-archive-zip-'));
        const fileName = 'entry-heavy.charx';
        tempRoots.push(root);
        fs.writeFileSync(path.join(root, fileName), createEntryHeavyCharX());
        const response = createResponse();

        await importCharacterHandler({
            body: { file_type: 'charx' },
            file: { destination: root, filename: fileName },
            user: { directories: {} },
        }, response);

        expect(response.statusCode).toBe(413);
        expect(response.send).toHaveBeenCalledWith({ error: expect.stringContaining('1000 entry limit') });
    });
});

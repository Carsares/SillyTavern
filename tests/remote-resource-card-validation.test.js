import fs from 'node:fs';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

import encode from '../src/png/encode.js';

const fetchMock = jest.fn();
jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));

let aicgRentryEventsProvider;
let sillyTavernAiChatProvider;

beforeAll(async () => {
    ({ aicgRentryEventsProvider } = await import('../src/remote-resources/providers/aicg-rentry-events.js'));
    ({ sillyTavernAiChatProvider } = await import('../src/remote-resources/providers/sillytavernai-chat.js'));
});

const NUL = Buffer.from([0]);
const PROVIDER_DIR = new URL('../src/remote-resources/providers/', import.meta.url);

function cardText(name) {
    return Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name } }), 'utf8').toString('base64');
}

function chunk(name, data) {
    return { name, data: new Uint8Array(data) };
}

function zTXt(keyword, text) {
    return chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), NUL, Buffer.from([0]), zlib.deflateSync(Buffer.from(text, 'latin1'))]));
}

function tEXt(keyword, text) {
    return chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), NUL, Buffer.from(text, 'latin1')]));
}

function buildPng(textChunks) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.from(encode([
        chunk('IHDR', ihdr),
        ...textChunks,
        chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255]))),
        chunk('IEND', Buffer.alloc(0)),
    ]));
}

function respondWith(buffer) {
    fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: name => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    });
}

describe('remote resource PNG card validation', () => {
    beforeEach(() => {
        fetchMock.mockReset();
    });

    const downloads = [
        ['AICG Rentry Events', () => aicgRentryEventsProvider.download({ resourceId: 'https://files.catbox.moe/abc123.png', resourceType: 'character' })],
        ['手机酒馆AI', () => sillyTavernAiChatProvider.download({ resourceId: 'https://www.sillytavernai.chat/silly_tavern_character_cards/card.png', resourceType: 'character' })],
    ];

    test.each(downloads)('%s accepts a card stored in a zTXt chunk', async (_name, download) => {
        const card = buildPng([zTXt('chara', cardText('Compressed card'))]);
        respondWith(card);

        const result = await download();

        expect(result.buffer.equals(card)).toBe(true);
        expect(result.resourceType).toBe('character');
    });

    test.each(downloads)('%s accepts an upper-case card keyword', async (_name, download) => {
        respondWith(buildPng([tEXt('CHARA', cardText('Upper keyword'))]));

        await expect(download()).resolves.toMatchObject({ resourceType: 'character' });
    });

    test.each(downloads)('%s still rejects a PNG without card metadata', async (_name, download) => {
        respondWith(buildPng([tEXt('Comment', 'just an image')]));

        await expect(download()).rejects.toThrow();
    });

    test('providers validate PNG cards through the shared parser helper instead of their own chunk checks', () => {
        const files = fs.readdirSync(PROVIDER_DIR).filter(file => file.endsWith('.js'));
        const offenders = files.filter(file => {
            const source = fs.readFileSync(new URL(file, PROVIDER_DIR), 'utf8');
            return /png-chunks?-(?:extract|text)|['"]tEXt['"]|['"]iTXt['"]/.test(source);
        });

        expect(offenders).toEqual([]);
    });
});

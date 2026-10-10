import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import extract from 'png-chunks-extract';

import encode from '../src/png/encode.js';
import { hasCharacterCardData, read, write } from '../src/character-card-parser.js';

const NUL = Buffer.from([0]);

function makeCard(name, spec = 'chara_card_v2') {
    return JSON.stringify({
        spec,
        spec_version: spec === 'chara_card_v3' ? '3.0' : '2.0',
        data: { name, description: `${name} — 描述` },
    });
}

function toBase64(json) {
    return Buffer.from(json, 'utf8').toString('base64');
}

function chunk(name, data) {
    return { name, data: new Uint8Array(data) };
}

function tEXt(keyword, text) {
    return chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), NUL, Buffer.from(text, 'latin1')]));
}

function zTXt(keyword, text, { method = 0, compressed = zlib.deflateSync(Buffer.from(text, 'latin1')) } = {}) {
    return chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), NUL, Buffer.from([method]), compressed]));
}

function iTXt(keyword, text, { compressed = false, language = '', translatedKeyword = '' } = {}) {
    const textBytes = Buffer.from(text, 'utf8');
    return chunk('iTXt', Buffer.concat([
        Buffer.from(keyword, 'latin1'), NUL,
        Buffer.from([compressed ? 1 : 0, 0]),
        Buffer.from(language, 'latin1'), NUL,
        Buffer.from(translatedKeyword, 'utf8'), NUL,
        compressed ? zlib.deflateSync(textBytes) : textBytes,
    ]));
}

function buildPng(textChunks) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolor
    const idat = zlib.deflateSync(Buffer.from([0, 255, 255, 255]));
    return Buffer.from(encode([
        chunk('IHDR', ihdr),
        ...textChunks,
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ]));
}

function readName(image) {
    return JSON.parse(read(image)).data.name;
}

describe('character-card-parser read()', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('reads chara from a tEXt chunk', () => {
        const card = makeCard('Text Chara');
        expect(read(buildPng([tEXt('chara', toBase64(card))]))).toBe(card);
    });

    test('prefers ccv3 over chara in tEXt chunks', () => {
        const image = buildPng([
            tEXt('chara', toBase64(makeCard('V2'))),
            tEXt('ccv3', toBase64(makeCard('V3', 'chara_card_v3'))),
        ]);
        expect(readName(image)).toBe('V3');
    });

    test('reads chara from a zTXt chunk', () => {
        const card = makeCard('Furina — 水神');
        expect(read(buildPng([zTXt('chara', toBase64(card))]))).toBe(card);
    });

    test('prefers zTXt ccv3 over zTXt chara regardless of order', () => {
        const image = buildPng([
            zTXt('chara', toBase64(makeCard('V2'))),
            zTXt('ccv3', toBase64(makeCard('V3', 'chara_card_v3'))),
        ]);
        expect(readName(image)).toBe('V3');
    });

    test('applies ccv3 precedence and case-insensitive keywords across chunk types', () => {
        const image = buildPng([
            tEXt('chara', toBase64(makeCard('Text V2'))),
            zTXt('CCV3', toBase64(makeCard('Compressed V3', 'chara_card_v3'))),
        ]);
        expect(readName(image)).toBe('Compressed V3');
    });

    test('reads chara from an uncompressed iTXt chunk', () => {
        const card = makeCard('iTXt plain');
        expect(read(buildPng([iTXt('chara', toBase64(card))]))).toBe(card);
    });

    test('reads ccv3 from a compressed iTXt chunk with language tag and translated keyword', () => {
        const image = buildPng([
            tEXt('chara', toBase64(makeCard('V2'))),
            iTXt('ccv3', toBase64(makeCard('iTXt compressed', 'chara_card_v3')), {
                compressed: true,
                language: 'zh-CN',
                translatedKeyword: '角色卡',
            }),
        ]);
        expect(readName(image)).toBe('iTXt compressed');
    });

    test('falls back to another chunk when a compressed ccv3 chunk is corrupt', () => {
        const image = buildPng([
            zTXt('ccv3', '', { compressed: Buffer.from('not zlib data') }),
            tEXt('chara', toBase64(makeCard('Fallback'))),
        ]);
        expect(readName(image)).toBe('Fallback');
        expect(console.warn).toHaveBeenCalled();
    });

    test('skips zTXt chunks with an unsupported compression method', () => {
        const image = buildPng([
            zTXt('ccv3', toBase64(makeCard('Bad method', 'chara_card_v3')), { method: 1 }),
            zTXt('chara', toBase64(makeCard('Good method'))),
        ]);
        expect(readName(image)).toBe('Good method');
    });

    test('throws the existing error when there are no text chunks', () => {
        expect(() => read(buildPng([]))).toThrow('No PNG metadata.');
        expect(console.error).toHaveBeenCalledWith('PNG metadata does not contain any text chunks.');
    });

    test('throws the existing error when text chunks hold no readable character data', () => {
        const image = buildPng([
            tEXt('Comment', 'hello'),
            zTXt('chara', '', { compressed: Buffer.from('broken') }),
        ]);
        expect(() => read(image)).toThrow('No PNG metadata.');
        expect(console.error).toHaveBeenCalledWith('PNG metadata does not contain any character data.');
    });
});

describe('character-card-parser hasCharacterCardData()', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        ['a tEXt chara chunk', () => tEXt('chara', toBase64(makeCard('Text')))],
        ['a zTXt chara chunk', () => zTXt('chara', toBase64(makeCard('Compressed')))],
        ['a zTXt chunk with an upper-case CCV3 keyword', () => zTXt('CCV3', toBase64(makeCard('Upper', 'chara_card_v3')))],
        ['an uncompressed iTXt chara chunk', () => iTXt('chara', toBase64(makeCard('iTXt')))],
        ['a compressed iTXt ccv3 chunk', () => iTXt('ccv3', toBase64(makeCard('iTXt z', 'chara_card_v3')), { compressed: true })],
    ])('accepts card data stored in %s', (_label, createChunk) => {
        expect(hasCharacterCardData(buildPng([createChunk()]))).toBe(true);
    });

    test('agrees with read() when a corrupt ccv3 chunk falls back to a readable chara chunk', () => {
        const image = buildPng([
            zTXt('ccv3', '', { compressed: Buffer.from('not zlib data') }),
            zTXt('chara', toBase64(makeCard('Fallback'))),
        ]);
        expect(hasCharacterCardData(image)).toBe(true);
        expect(readName(image)).toBe('Fallback');
    });

    test.each([
        ['a PNG without text chunks', () => buildPng([])],
        ['a PNG with only unrelated text chunks', () => buildPng([tEXt('Comment', 'hello'), zTXt('Software', 'editor')])],
        ['a PNG whose only card chunk cannot be inflated', () => buildPng([zTXt('chara', '', { compressed: Buffer.from('broken') })])],
        ['a PNG whose card chunk is empty', () => buildPng([tEXt('chara', '')])],
        ['bytes that are not a PNG', () => Buffer.from('<!doctype html><title>Not a card</title>')],
        ['an empty buffer', () => Buffer.alloc(0)],
    ])('rejects %s without logging', (_label, createImage) => {
        expect(hasCharacterCardData(createImage())).toBe(false);
        expect(console.error).not.toHaveBeenCalled();
        expect(console.warn).not.toHaveBeenCalled();
    });
});

describe('character-card-parser write()', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('replaces compressed card chunks so read() returns the newly written data', () => {
        const original = buildPng([
            zTXt('chara', toBase64(makeCard('Old V2'))),
            zTXt('ccv3', toBase64(makeCard('Old V3', 'chara_card_v3'))),
            iTXt('CCV3', toBase64(makeCard('Old iTXt V3', 'chara_card_v3')), { compressed: true }),
            zTXt('Comment', 'keep me'),
        ]);
        expect(readName(original)).toBe('Old V3');

        const updated = write(original, makeCard('New Name'));
        const parsed = JSON.parse(read(updated));
        expect(parsed.data.name).toBe('New Name');
        expect(parsed.spec).toBe('chara_card_v3');

        const chunks = extract(new Uint8Array(updated));
        const textChunks = chunks
            .filter(item => ['tEXt', 'zTXt', 'iTXt'].includes(item.name))
            .map(item => `${item.name}:${Buffer.from(item.data).subarray(0, Buffer.from(item.data).indexOf(0)).toString('latin1')}`);
        expect(textChunks).toEqual(['zTXt:Comment', 'tEXt:chara', 'tEXt:ccv3']);
        expect(chunks.at(-1).name).toBe('IEND');
    });
});

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

import encode from './png/encode.js';
import extract from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

/**
 * Character card keywords, in read precedence order (V3 first).
 */
const CARD_KEYWORDS = ['ccv3', 'chara'];

/**
 * PNG chunk types that can carry textual metadata.
 */
const TEXT_CHUNK_NAMES = ['tEXt', 'zTXt', 'iTXt'];

/**
 * Upper bound for a single inflated zTXt/iTXt payload, guards against decompression bombs.
 */
const MAX_INFLATED_TEXT_BYTES = 128 * 1024 * 1024;

/**
 * Wraps PNG chunk data into a Buffer without copying.
 * @param {Uint8Array} data Chunk data
 * @returns {Buffer} Buffer view over the chunk data
 */
function toBuffer(data) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Reads the Latin-1 keyword of a tEXt, zTXt or iTXt chunk.
 * @param {Buffer} bytes Chunk data
 * @returns {{ keyword: string, offset: number }} Keyword and the offset of the first byte after its null separator
 */
function readChunkKeyword(bytes) {
    const separator = bytes.indexOf(0);
    if (separator === -1) {
        return { keyword: bytes.toString('latin1'), offset: bytes.length };
    }
    return { keyword: bytes.subarray(0, separator).toString('latin1'), offset: separator + 1 };
}

/**
 * Inflates zlib-compressed text chunk data.
 * @param {Buffer} data Compressed data
 * @param {number} compressionMethod Compression method byte from the chunk
 * @returns {Buffer} Inflated data
 */
function inflateText(data, compressionMethod) {
    if (compressionMethod !== 0) {
        throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }
    return zlib.inflateSync(data, { maxOutputLength: MAX_INFLATED_TEXT_BYTES });
}

/**
 * Decodes the text payload of a tEXt, zTXt or iTXt chunk.
 * tEXt and zTXt text is Latin-1, iTXt text is UTF-8.
 * @param {string} name Chunk type
 * @param {Buffer} bytes Chunk data
 * @param {number} offset Offset of the first byte after the keyword separator
 * @returns {string} Decoded text
 */
function decodeChunkText(name, bytes, offset) {
    switch (name) {
        case 'tEXt':
            return bytes.subarray(offset).toString('latin1');
        case 'zTXt':
            return inflateText(bytes.subarray(offset + 1), bytes[offset]).toString('latin1');
        case 'iTXt': {
            const compressionFlag = bytes[offset];
            const compressionMethod = bytes[offset + 1];
            const languageTagEnd = bytes.indexOf(0, offset + 2);
            const translatedKeywordEnd = languageTagEnd === -1 ? -1 : bytes.indexOf(0, languageTagEnd + 1);
            if (translatedKeywordEnd === -1) {
                throw new Error('Malformed iTXt chunk');
            }
            const text = bytes.subarray(translatedKeywordEnd + 1);
            if (compressionFlag === 0) {
                return text.toString('utf8');
            }
            if (compressionFlag === 1) {
                return inflateText(text, compressionMethod).toString('utf8');
            }
            throw new Error(`Unsupported iTXt compression flag: ${compressionFlag}`);
        }
    }
    throw new Error(`Unsupported text chunk type: ${name}`);
}

/**
 * Checks whether a PNG chunk is a text chunk holding character card data.
 * @param {{ name: string, data: Uint8Array }} chunk PNG chunk
 * @returns {boolean} True for tEXt/zTXt/iTXt chunks with a 'chara' or 'ccv3' keyword
 */
function isCardTextChunk(chunk) {
    if (!TEXT_CHUNK_NAMES.includes(chunk.name)) {
        return false;
    }
    const { keyword } = readChunkKeyword(toBuffer(chunk.data));
    return CARD_KEYWORDS.includes(keyword.toLowerCase());
}

/**
 * Writes Character metadata to a PNG image buffer.
 * Existing 'chara' and 'ccv3' tEXt/zTXt/iTXt chunks are removed, new ones are written as tEXt.
 * @param {Buffer} image PNG image buffer
 * @param {string} data Character data to write
 * @returns {Buffer} PNG image buffer with metadata
 */
export const write = (image, data) => {
    // Remove existing character chunks, compressed ones would otherwise shadow the new tEXt data
    const chunks = extract(new Uint8Array(image)).filter(chunk => !isCardTextChunk(chunk));

    // Add new v2 chunk before the IEND chunk
    const base64EncodedData = Buffer.from(data, 'utf8').toString('base64');
    chunks.splice(-1, 0, PNGtext.encode('chara', base64EncodedData));

    // Try adding v3 chunk before the IEND chunk
    try {
        //change v2 format to v3
        const v3Data = JSON.parse(data);
        v3Data.spec = 'chara_card_v3';
        v3Data.spec_version = '3.0';

        const base64EncodedData = Buffer.from(JSON.stringify(v3Data), 'utf8').toString('base64');
        chunks.splice(-1, 0, PNGtext.encode('ccv3', base64EncodedData));
    } catch (error) {
        // Ignore errors when adding v3 chunk
    }

    const newBuffer = Buffer.from(encode(chunks));
    return newBuffer;
};

/**
 * Reads Character metadata from a PNG image buffer.
 * Supports both V2 (chara) and V3 (ccv3) stored in tEXt, zTXt or iTXt chunks. V3 (ccv3) takes precedence.
 * @param {Buffer} image PNG image buffer
 * @returns {string} Character data
 */
export const read = (image) => {
    const chunks = extract(new Uint8Array(image));

    const textChunks = chunks
        .filter((chunk) => TEXT_CHUNK_NAMES.includes(chunk.name))
        .map((chunk) => {
            const bytes = toBuffer(chunk.data);
            const { keyword, offset } = readChunkKeyword(bytes);
            return { name: chunk.name, keyword: keyword.toLowerCase(), bytes, offset };
        });

    if (textChunks.length === 0) {
        console.error('PNG metadata does not contain any text chunks.');
        throw new Error('No PNG metadata.');
    }

    for (const keyword of CARD_KEYWORDS) {
        for (const chunk of textChunks.filter((textChunk) => textChunk.keyword === keyword)) {
            try {
                const text = decodeChunkText(chunk.name, chunk.bytes, chunk.offset);
                return Buffer.from(text, 'base64').toString('utf8');
            } catch (error) {
                console.warn(`Skipping unreadable ${chunk.name} '${keyword}' chunk in PNG metadata: ${error.message}`);
            }
        }
    }

    console.error('PNG metadata does not contain any character data.');
    throw new Error('No PNG metadata.');
};

/**
 * Parses a card image and returns the character metadata.
 * @param {string} cardUrl Path to the card image
 * @param {string} format File format
 * @returns {Promise<string>} Character data
 */
export const parse = async (cardUrl, format) => {
    let fileFormat = format === undefined ? 'png' : format;

    switch (fileFormat) {
        case 'png': {
            const buffer = fs.readFileSync(cardUrl);
            return read(buffer);
        }
    }

    throw new Error('Unsupported format');
};

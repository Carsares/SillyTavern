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
 * Upper bound for all zTXt/iTXt payloads inflated while reading one image, guards against decompression bombs.
 */
const MAX_INFLATED_TEXT_BYTES = 128 * 1024 * 1024;

/**
 * Highest output-to-input ratio of a deflate stream (258 bytes from a 2-bit match code).
 */
const MAX_DEFLATE_RATIO = 1032;

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
 * Inflates zlib-compressed text chunk data within the remaining decompression budget of one image.
 * @param {Buffer} data Compressed data
 * @param {number} compressionMethod Compression method byte from the chunk
 * @param {{ remaining: number }} budget Bytes that may still be inflated, reduced by this call
 * @returns {Buffer} Inflated data
 */
function inflateText(data, compressionMethod, budget) {
    if (compressionMethod !== 0) {
        throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }
    if (budget.remaining <= 0) {
        throw new Error('Decompression limit for this image reached');
    }
    try {
        const inflated = zlib.inflateSync(data, { maxOutputLength: budget.remaining });
        budget.remaining -= inflated.length;
        return inflated;
    } catch (error) {
        // The output produced before a failure is not reported, so charge the most this input could have inflated to.
        budget.remaining = error?.code === 'ERR_BUFFER_TOO_LARGE' ? 0 : Math.max(0, budget.remaining - data.length * MAX_DEFLATE_RATIO);
        throw error;
    }
}

/**
 * Decodes the text payload of a tEXt, zTXt or iTXt chunk.
 * tEXt and zTXt text is Latin-1, iTXt text is UTF-8.
 * @param {string} name Chunk type
 * @param {Buffer} bytes Chunk data
 * @param {number} offset Offset of the first byte after the keyword separator
 * @param {{ remaining: number }} budget Decompression budget shared by the chunks of one image
 * @returns {string} Decoded text
 */
function decodeChunkText(name, bytes, offset, budget) {
    switch (name) {
        case 'tEXt':
            return bytes.subarray(offset).toString('latin1');
        case 'zTXt':
            return inflateText(bytes.subarray(offset + 1), bytes[offset], budget).toString('latin1');
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
                return inflateText(text, compressionMethod, budget).toString('utf8');
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
 * Lists the tEXt, zTXt and iTXt chunks of a PNG image with their lowercased keywords.
 * @param {Buffer} image PNG image buffer
 * @returns {{ name: string, keyword: string, bytes: Buffer, offset: number }[]} Text chunks in file order
 */
function getTextChunks(image) {
    return extract(new Uint8Array(image))
        .filter((chunk) => TEXT_CHUNK_NAMES.includes(chunk.name))
        .map((chunk) => {
            const bytes = toBuffer(chunk.data);
            const { keyword, offset } = readChunkKeyword(bytes);
            return { name: chunk.name, keyword: keyword.toLowerCase(), bytes, offset };
        });
}

/**
 * Finds the base64 text of the first readable character card chunk, V3 (ccv3) first.
 * Compressed chunks share one decompression budget; once it is spent, only uncompressed chunks are still read.
 * @param {{ name: string, keyword: string, bytes: Buffer, offset: number }[]} textChunks Text chunks from getTextChunks()
 * @param {(chunk: { name: string }, keyword: string, error: Error) => void} [onUnreadable] Called for each chunk that cannot be decoded
 * @returns {string|null} Encoded card text, or null when no card chunk is readable
 */
function findCardText(textChunks, onUnreadable) {
    const budget = { remaining: MAX_INFLATED_TEXT_BYTES };
    for (const keyword of CARD_KEYWORDS) {
        for (const chunk of textChunks.filter((textChunk) => textChunk.keyword === keyword)) {
            try {
                return decodeChunkText(chunk.name, chunk.bytes, chunk.offset, budget);
            } catch (error) {
                onUnreadable?.(chunk, keyword, error);
            }
        }
    }
    return null;
}

/**
 * Reads Character metadata from a PNG image buffer.
 * Supports both V2 (chara) and V3 (ccv3) stored in tEXt, zTXt or iTXt chunks. V3 (ccv3) takes precedence.
 * @param {Buffer} image PNG image buffer
 * @returns {string} Character data
 */
export const read = (image) => {
    const textChunks = getTextChunks(image);

    if (textChunks.length === 0) {
        console.error('PNG metadata does not contain any text chunks.');
        throw new Error('No PNG metadata.');
    }

    const text = findCardText(textChunks, (chunk, keyword, error) => {
        console.warn(`Skipping unreadable ${chunk.name} '${keyword}' chunk in PNG metadata: ${error.message}`);
    });
    if (text !== null) {
        return Buffer.from(text, 'base64').toString('utf8');
    }

    console.error('PNG metadata does not contain any character data.');
    throw new Error('No PNG metadata.');
};

/**
 * Checks whether a PNG image buffer carries character card data that read() can return.
 * Uses the same tEXt/zTXt/iTXt decoding and ccv3-over-chara precedence as read(), without logging.
 * @param {Buffer} image PNG image buffer
 * @returns {boolean} True when the card chunk read() would pick decodes to non-empty text
 */
export const hasCharacterCardData = (image) => {
    try {
        const text = findCardText(getTextChunks(image));
        return Boolean(text && text.trim());
    } catch {
        return false;
    }
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

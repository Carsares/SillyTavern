import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import express from 'express';
import sanitize from 'sanitize-filename';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { imageSize } from 'image-size';

import { readSecret, SECRET_KEYS } from './secrets.js';
import { clientRelativePath, humanizedDateTime, isPathUnderParent } from '../util.js';
import { AUXILIARY_PROVIDERS, getAuxiliaryCapabilities } from '../conversation/capabilities/auxiliary/index.js';
import { createAuxiliaryAdapter } from '../conversation/providers/auxiliary/index.js';
import { validateImageOptions } from '../conversation/providers/auxiliary/image-native.js';
import { createConnectionFetch } from '../conversation/providers/core/proxy.js';
import { downloadImage } from '../conversation/composition/download.js';

// Chat image generation (docs/image-generation/BACKEND-DESIGN.md). Non-secret settings come from the request body, the
// key is read on the server by id. A generation is never tied to the browser connection: it keeps running when the
// client disconnects, its result stays queryable in memory, and only an explicit cancel aborts it. Failures answer
// `{ error, message, detail?, outcome }`, where `outcome` tells whether the provider may have billed the request.
// Prompts, keys and URLs never reach error bodies or logs.

const LOG_PREFIX = '[image-generation]';

/** P1 provider whitelist. Only a local SD WebUI may run without a key. */
const PROVIDERS = Object.freeze({
    openai: Object.freeze({ requiresKey: true }),
    'openai-compatible': Object.freeze({ requiresKey: true }),
    google: Object.freeze({ requiresKey: true }),
    openrouter: Object.freeze({ requiresKey: true }),
    novelai: Object.freeze({ requiresKey: true }),
    automatic1111: Object.freeze({ requiresKey: false }),
});

/** Request fields that are not image parameters. */
const BASE_FIELDS = new Set(['requestId', 'provider', 'model', 'baseUrl', 'secretId', 'characterName', 'prompt']);
/** Adapter parameters that are not user controls. */
const HIDDEN_PARAMETERS = new Set(['prompt', 'jobId', 'onJob']);
/** Adapter error codes that are raised before anything is dispatched, even when the adapter marks them unknown. */
const UNSENT_ERROR_CODES = new Set(['invalid-connection', 'invalid-request', 'invalid-transport', 'invalid-proxy']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const IMAGE_EXTENSIONS = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
const MAX_PROMPT_LENGTH = 8000;
const MAX_FIELD_LENGTH = 2048;
const MAX_FOLDER_BYTES = 128;
const DEFAULT_FOLDER = 'generated';
const MAX_COUNT = 4;
const MAX_DIMENSION = 4096;

/**
 * @typedef {'not-charged'|'unknown'|'charged'} Outcome
 * @typedef {'pending'|'completed'|'failed'|'cancelled'} RecordStatus
 *
 * @typedef {object} SavedImage
 * @property {string} path Raw client path such as `/user/images/<folder>/<file>`, not URL-encoded
 * @property {string} mimeType Detected MIME type
 * @property {number} bytes File size
 * @property {number} width Width in pixels
 * @property {number} height Height in pixels
 *
 * @typedef {object} GenerationRecord
 * @property {string} requestId Client generated UUID (lowercase)
 * @property {RecordStatus} status Current state
 * @property {string} provider Provider id
 * @property {string} model Model id
 * @property {number} startedAt Epoch milliseconds
 * @property {number|null} finishedAt Epoch milliseconds once no longer pending
 * @property {AbortController} controller Aborted only by an explicit cancel
 * @property {object|null} result Completed response body
 * @property {ImageGenerationError|null} failure Failure for failed and cancelled records
 * @property {Promise<void>} finished Settles when the record leaves the pending state
 * @property {() => void} settle Settles `finished`
 *
 * @typedef {object} UserState
 * @property {GenerationRecord|null} active The request currently allowed to run
 * @property {Map<string, GenerationRecord>} records Records by request id, in insertion order
 */

/**
 * Failure with an HTTP status and a public body. The message is fixed English text; it never contains the prompt, the key
 * or a URL. `reason` is an internal code for logs only.
 */
class ImageGenerationError extends Error {
    /**
     * @param {number} status HTTP status
     * @param {string} code Machine readable error code
     * @param {string} message Short English description
     * @param {Outcome} outcome Whether the provider may have billed the request
     * @param {object} [options] Extra fields
     * @param {string} [options.detail] Redacted provider reason
     * @param {string} [options.reason] Internal code for logs
     */
    constructor(status, code, message, outcome, { detail = '', reason = '' } = {}) {
        super(message);
        this.name = 'ImageGenerationError';
        this.status = status;
        this.code = code;
        this.outcome = outcome;
        this.detail = detail;
        this.reason = reason;
    }

    /** @returns {{ error: string, message: string, detail?: string, outcome: Outcome }} Public body */
    toBody() {
        return { error: this.code, message: this.message, ...(this.detail ? { detail: this.detail } : {}), outcome: this.outcome };
    }
}

/**
 * @param {string} message Description of the invalid field
 * @returns {ImageGenerationError} 400 invalid-request
 */
function invalidRequest(message) {
    return new ImageGenerationError(400, 'invalid-request', message, 'not-charged');
}

/** @returns {ImageGenerationError} 409 cancelled */
function cancelledError() {
    return new ImageGenerationError(409, 'cancelled', 'Image generation was cancelled.', 'unknown');
}

/**
 * Short internal description of an exception for logs: an error code or name, never its message (which can contain URLs,
 * paths or provider text).
 * @param {any} error Caught exception
 * @returns {string} Code such as `provider-http-error`, `ENOENT` or `TimeoutError`
 */
function describeCode(error) {
    const code = error?.code ?? error?.cause?.code;
    if (typeof code === 'string' && /^[\w.-]{1,64}$/.test(code)) {
        return code;
    }
    return typeof error?.name === 'string' && /^\w{1,64}$/.test(error.name) ? error.name : 'unknown';
}

/**
 * @param {unknown} value Value
 * @param {number} [length] Maximum length
 * @returns {string} Single line for logs
 */
function truncateForLog(value, length = 100) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

/**
 * Cuts a string to at most `maxBytes` UTF-8 bytes without splitting a character.
 * @param {string} text Text
 * @param {number} maxBytes Byte limit
 * @returns {string} Truncated text
 */
function truncateUtf8(text, maxBytes) {
    let result = '';
    let bytes = 0;
    for (const char of text) {
        bytes += Buffer.byteLength(char);
        if (bytes > maxBytes) {
            break;
        }
        result += char;
    }
    return result;
}

/**
 * Folder below user/images for a character or group. The /user/images route runs decodeURIComponent on the path, so a
 * `%` would make it fail and a `#` would cut the URL short; both become `_`.
 * @param {string} characterName Character or group name
 * @returns {string} Safe single path segment
 */
function getFolderName(characterName) {
    const cleaned = sanitize(characterName).replace(/[%#]/g, '_');
    return sanitize(truncateUtf8(cleaned, MAX_FOLDER_BYTES)) || DEFAULT_FOLDER;
}

/**
 * @param {Buffer} bytes File content
 * @returns {string|null} PNG, JPEG or WebP MIME type from the file signature
 */
function detectImageType(bytes) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

/**
 * @param {unknown} body Request body
 * @returns {Record<string, any>} Body object
 */
function requireBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw invalidRequest('Request body must be a JSON object.');
    }
    return /** @type {Record<string, any>} */ (body);
}

/**
 * @param {unknown} value Request id
 * @returns {string} Lowercase UUID
 */
function readRequestId(value) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw invalidRequest('requestId must be a UUID.');
    }
    return value.toLowerCase();
}

/**
 * @param {unknown} value Optional string field
 * @param {string} name Field name
 * @returns {string} The string, or an empty string when absent
 */
function readOptionalString(value, name) {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
        throw invalidRequest(`${name} must be a string of at most ${MAX_FIELD_LENGTH} characters.`);
    }
    return value.trim();
}

/**
 * @param {import('express').Request} request Request
 * @returns {string} User handle
 */
function getHandle(request) {
    const handle = request.user?.profile?.handle;
    if (typeof handle !== 'string' || !handle) {
        throw new Error('Missing user handle');
    }
    return handle;
}

/**
 * Resolves the provider, the adapter capability and the public parameter list. Never makes a network request.
 * @param {Record<string, any>} body Request body
 */
function readTarget(body) {
    if (typeof body.provider !== 'string' || !body.provider) {
        throw invalidRequest('provider is required.');
    }
    if (!Object.hasOwn(PROVIDERS, body.provider)) {
        throw new ImageGenerationError(400, 'unsupported-provider', 'This provider is not available for image generation.', 'not-charged');
    }
    const provider = body.provider;
    const model = readOptionalString(body.model, 'model');
    const baseUrl = readOptionalString(body.baseUrl, 'baseUrl');
    const capability = getAuxiliaryCapabilities({ provider, model, ...(baseUrl ? { baseUrl } : {}), type: 'image' });
    const parameters = (capability.operationParameters?.generateImage ?? []).filter(key => !HIDDEN_PARAMETERS.has(key));
    // The parameter table is wider than some codecs: the Gemini codec takes one candidate, NovelAI needs multiples of 64.
    const gemini = capability.api === 'google-image' && !/^(imagen-|imagegeneration)/.test(model);
    const limits = {
        countMax: parameters.includes('count') ? (gemini ? 1 : MAX_COUNT) : 1,
        maxDimension: parameters.includes('width') || parameters.includes('height') ? MAX_DIMENSION : null,
        dimensionMultiple: provider === 'novelai' ? 64 : null,
    };
    // openai-compatible and the local SD WebUI have no default address in the adapter profiles.
    const profile = AUXILIARY_PROVIDERS[provider];
    const requiresBaseUrl = !profile.imageBaseUrl && !profile.baseUrl;
    return { provider, model, baseUrl, capability, parameters, limits, requiresBaseUrl };
}

/**
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} secretId Secret entry id, or empty for the active entry
 * @returns {string} Key, or an empty string when the entry is missing or empty
 */
function readImageKey(directories, secretId) {
    return readSecret(directories, SECRET_KEYS.IMAGE_GENERATION, secretId || null);
}

/**
 * Validates the generation fields that do not depend on server state.
 * @param {Record<string, any>} body Request body
 */
function readGenerationRequest(body) {
    const requestId = readRequestId(body.requestId);
    const target = readTarget(body);
    if (!target.model) {
        throw invalidRequest('model is required.');
    }
    if (!target.capability.supported) {
        // Capability reasons are fixed texts such as "Explicit baseUrl required".
        throw invalidRequest(`Invalid image provider configuration: ${target.capability.reason ?? 'unsupported'}.`);
    }
    if (typeof body.characterName !== 'string' || body.characterName.length > MAX_FIELD_LENGTH) {
        throw invalidRequest('characterName must be a string.');
    }
    if (typeof body.prompt !== 'string' || !body.prompt.trim() || Array.from(body.prompt).length > MAX_PROMPT_LENGTH) {
        throw invalidRequest(`prompt must contain 1 to ${MAX_PROMPT_LENGTH} characters.`);
    }
    const secretId = readOptionalString(body.secretId, 'secretId');

    /** @type {Record<string, any>} */
    const parameters = {};
    for (const [key, value] of Object.entries(body)) {
        // null means "not set", like the defaults the front end keeps (seed: null).
        if (BASE_FIELDS.has(key) || value === null || value === undefined) {
            continue;
        }
        if (!target.parameters.includes(key)) {
            throw invalidRequest(`Parameter ${truncateForLog(key, 64)} is not supported by this provider.`);
        }
        parameters[key] = value;
    }
    try {
        validateImageOptions({ prompt: body.prompt, ...parameters }, target.capability);
    } catch (error) {
        throw invalidRequest(typeof error?.message === 'string' ? truncateForLog(error.message, 200) : 'Invalid image parameters.');
    }
    if (parameters.count !== undefined && parameters.count > target.limits.countMax) {
        throw invalidRequest(`count must not exceed ${target.limits.countMax} for this model.`);
    }
    return { requestId, ...target, characterName: body.characterName, prompt: body.prompt, secretId, parameters };
}

/**
 * Maps an adapter failure from the generation call. Errors without an outcome were raised before dispatch.
 * @param {any} error Adapter error
 * @param {boolean} timedOut Whether the request deadline elapsed
 * @param {number} timeoutMs Deadline
 * @returns {ImageGenerationError} Public failure
 */
function toProviderFailure(error, timedOut, timeoutMs) {
    const code = describeCode(error);
    if (timedOut || error?.name === 'TimeoutError') {
        return new ImageGenerationError(504, 'provider-timeout', `The image provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'unknown', { reason: code });
    }
    if (!error?.details?.outcome || UNSENT_ERROR_CODES.has(code)) {
        const message = typeof error?.message === 'string' && error.message ? truncateForLog(error.message, 200) : 'Invalid image parameters.';
        return new ImageGenerationError(400, 'invalid-request', message, 'not-charged', { reason: code });
    }
    switch (code) {
        case 'provider-http-error': {
            const status = Number.isSafeInteger(error.details?.status) ? error.details.status : null;
            const providerMessage = error.details?.providerMessage;
            return new ImageGenerationError(502, 'provider-http-error', status ? `The image provider returned HTTP ${status}.` : 'The image provider returned an error.', 'unknown', {
                detail: typeof providerMessage === 'string' ? providerMessage : '',
                reason: status ? `HTTP ${status}` : '',
            });
        }
        case 'provider-error':
        case 'provider-job-failed':
            return new ImageGenerationError(502, 'provider-http-error', 'The image provider reported a failure.', 'unknown', { reason: code });
        case 'provider-network-error':
        case 'transport-closed':
            return new ImageGenerationError(502, 'provider-network-error', 'The image provider could not be reached.', 'unknown', { reason: code });
        case 'aborted':
        case 'AbortError':
            // Only the deadline and an explicit cancel abort the call; cancellation is handled before this mapping.
            return new ImageGenerationError(504, 'provider-timeout', `The image provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'unknown', { reason: code });
        default:
            return new ImageGenerationError(502, 'provider-response-invalid', 'The image provider returned an invalid response.', 'unknown', { reason: code });
    }
}

/**
 * @param {import('express').Response} response Response
 * @param {number} status HTTP status
 * @param {object} body JSON body
 */
function sendJson(response, status, body) {
    // The client may have disconnected while the generation kept running (design D5).
    if (response.headersSent || response.writableEnded || response.destroyed) {
        return;
    }
    response.status(status).json(body);
}

/**
 * @param {import('express').Response} response Response
 * @param {any} error Failure
 */
function sendFailure(response, error) {
    if (error instanceof ImageGenerationError) {
        return sendJson(response, error.status, error.toBody());
    }
    console.error(`${LOG_PREFIX} Unexpected failure before the provider was called: ${describeCode(error)}`);
    return sendJson(response, 500, { error: 'internal-error', message: 'The image generation request could not be prepared.', outcome: 'not-charged' });
}

/**
 * Public state of a record, as returned by GET /requests/:requestId.
 * @param {GenerationRecord} record Record
 */
function describeRecord(record) {
    return {
        requestId: record.requestId,
        status: record.status,
        startedAt: record.startedAt,
        ...(record.status === 'completed' ? { images: record.result.images, incomplete: record.result.incomplete } : {}),
        ...(record.failure ? { error: record.failure.toBody() } : {}),
    };
}

/**
 * Answers a generate call from a record: the original result for a finished request, 202 for a pending one.
 * @param {import('express').Response} response Response
 * @param {GenerationRecord} record Record
 */
function sendRecord(response, record) {
    switch (record.status) {
        case 'completed':
            return sendJson(response, 200, record.result);
        case 'pending':
            return sendJson(response, 202, { requestId: record.requestId, status: 'pending', startedAt: record.startedAt });
        default:
            return sendJson(response, record.failure.status, record.failure.toBody());
    }
}

/**
 * Creates the image generation router. Options other than the defaults are for tests.
 * @param {object} [options] Options
 * @param {Function} [options.fetch] Injected transport for provider calls and image downloads (receives a WHATWG Request)
 * @param {Function} [options.lookup] Injected DNS lookup for image downloads
 * @param {() => number} [options.now] Clock in epoch milliseconds
 * @param {number} [options.retentionMs] How long finished records stay queryable
 * @param {number} [options.maxRecords] Records kept per user
 * @param {number} [options.timeoutMs] Provider deadline (1..600000)
 * @returns {import('express').Router} Router
 */
export function createImageGenerationRouter({ fetch, lookup, now = Date.now, retentionMs = 30 * 60 * 1000, maxRecords = 50, timeoutMs = 300000 } = {}) {
    const router = express.Router();
    /** @type {Map<string, UserState>} */
    const users = new Map();

    /**
     * Drops expired finished records and caps the record count. Pending records are never dropped.
     * @param {UserState} state User state
     */
    function prune(state) {
        const current = now();
        for (const [requestId, record] of state.records) {
            if (record.status !== 'pending' && current - record.finishedAt >= retentionMs) {
                state.records.delete(requestId);
            }
        }
        if (state.records.size > maxRecords) {
            const finished = [...state.records.values()]
                .filter(record => record.status !== 'pending')
                .sort((a, b) => a.finishedAt - b.finishedAt);
            while (state.records.size > maxRecords && finished.length) {
                state.records.delete(finished.shift().requestId);
            }
        }
    }

    /**
     * @param {string} handle User handle
     * @returns {UserState|undefined} Pruned state, if the user has any
     */
    function findUserState(handle) {
        const state = users.get(handle);
        if (!state) {
            return undefined;
        }
        prune(state);
        if (!state.active && !state.records.size) {
            users.delete(handle);
            return undefined;
        }
        return state;
    }

    /**
     * @param {string} handle User handle
     * @returns {UserState} Pruned state, created when missing
     */
    function getUserState(handle) {
        let state = findUserState(handle);
        if (!state) {
            state = { active: null, records: new Map() };
            users.set(handle, state);
        }
        return state;
    }

    /**
     * @param {GenerationRecord} record Record
     * @param {ImageGenerationError} failure Failure
     */
    function logFailure(record, failure) {
        const reason = failure.reason && failure.reason !== failure.code ? ` (${failure.reason})` : '';
        console.warn(`${LOG_PREFIX} Request ${record.requestId} failed: provider=${record.provider}, model=${truncateForLog(record.model)}, error=${failure.code}${reason}, elapsedMs=${now() - record.startedAt}`);
    }

    /**
     * @param {UserState} state User state
     * @param {GenerationRecord} record Pending record
     */
    function cancelRecord(state, record) {
        record.status = 'cancelled';
        record.finishedAt = now();
        record.failure = cancelledError();
        if (state.active === record) {
            state.active = null;
        }
        record.controller.abort();
        record.settle();
        console.info(`${LOG_PREFIX} Request ${record.requestId} cancelled: provider=${record.provider}, model=${truncateForLog(record.model)}, elapsedMs=${record.finishedAt - record.startedAt}`);
    }

    /**
     * Gets the bytes of one provider image: decoded base64, or a download restricted to public HTTPS.
     * @param {{ data?: string, url?: string }} image Adapter image
     * @param {AbortSignal} signal Cancel signal
     * @returns {Promise<Buffer>} Image bytes
     */
    async function readImageBytes(image, signal) {
        if (typeof image.data === 'string') {
            return Buffer.from(image.data, 'base64');
        }
        try {
            const downloaded = await downloadImage(image.url, { ...(fetch ? { fetch } : {}), ...(lookup ? { lookup } : {}), signal });
            return Buffer.from(downloaded.base64, 'base64');
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            throw new ImageGenerationError(502, 'image-download-failed', 'The generated image could not be downloaded.', 'charged', { reason: describeCode(error) });
        }
    }

    /**
     * Saves the provider images below user/images/<folder>. Each image fails on its own; the caller decides what a
     * partial result means. Throws only when cancelled.
     * @param {Array<{ data?: string, url?: string }>} images Adapter images
     * @param {import('../users.js').UserDirectoryList} directories User directories
     * @param {string} characterName Character or group name
     * @param {AbortSignal} signal Cancel signal
     * @returns {Promise<{ saved: SavedImage[], failures: ImageGenerationError[] }>} Outcome per image
     */
    async function saveImages(images, directories, characterName, signal) {
        const saved = [];
        const failures = [];
        const folder = getFolderName(characterName);
        const directory = path.join(directories.userImages, folder);
        try {
            if (!isPathUnderParent(directories.userImages, directory)) {
                throw new Error('Image folder escapes user images');
            }
            fs.mkdirSync(directory, { recursive: true });
        } catch (error) {
            const failure = new ImageGenerationError(500, 'save-failed', 'The generated image could not be saved.', 'charged', { reason: describeCode(error) });
            return { saved, failures: images.map(() => failure) };
        }

        const stamp = humanizedDateTime(now()).replace(/\d{3}ms$/, '');
        let index = 0;
        for (const image of images) {
            signal.throwIfAborted();
            const fromUrl = typeof image.data !== 'string';
            try {
                const bytes = await readImageBytes(image, signal);
                const mimeType = detectImageType(bytes);
                let dimensions = null;
                try {
                    dimensions = mimeType ? imageSize(bytes) : null;
                } catch {
                    dimensions = null;
                }
                if (!mimeType || !Number.isSafeInteger(dimensions?.width) || !Number.isSafeInteger(dimensions?.height)) {
                    throw fromUrl
                        ? new ImageGenerationError(502, 'image-download-failed', 'The downloaded file is not a PNG, JPEG or WebP image.', 'charged', { reason: 'invalid-image' })
                        : new ImageGenerationError(502, 'provider-response-invalid', 'The image provider returned data that is not a PNG, JPEG or WebP image.', 'unknown', { reason: 'invalid-image' });
                }

                let file;
                do {
                    index += 1;
                    file = path.join(directory, `${folder}_${stamp}_${index}.${IMAGE_EXTENSIONS[mimeType]}`);
                } while (fs.existsSync(file));
                signal.throwIfAborted();
                try {
                    if (!isPathUnderParent(directories.userImages, file)) {
                        throw new Error('Image file escapes user images');
                    }
                    writeFileAtomicSync(file, bytes);
                    saved.push({ path: clientRelativePath(directories.root, file), mimeType, bytes: bytes.length, width: dimensions.width, height: dimensions.height });
                } catch (error) {
                    throw new ImageGenerationError(500, 'save-failed', 'The generated image could not be saved.', 'charged', { reason: describeCode(error) });
                }
            } catch (error) {
                if (signal.aborted) {
                    throw error;
                }
                failures.push(error instanceof ImageGenerationError
                    ? error
                    : new ImageGenerationError(500, 'save-failed', 'The generated image could not be saved.', 'charged', { reason: describeCode(error) }));
            }
        }
        return { saved, failures };
    }

    /**
     * Runs one accepted generation to completion. Never throws; the outcome is stored in the record.
     * @param {UserState} state User state
     * @param {GenerationRecord} record Record
     * @param {object} job Prepared job
     * @param {ReturnType<typeof createAuxiliaryAdapter>} job.adapter Adapter
     * @param {{ close: () => void }} job.transport Connection transport
     * @param {Record<string, any>} job.input Prompt and parameters
     * @param {import('../users.js').UserDirectoryList} job.directories User directories
     * @param {string} job.characterName Character or group name
     */
    async function runGeneration(state, record, { adapter, transport, input, directories, characterName }) {
        const cancel = record.controller.signal;
        try {
            const deadline = AbortSignal.timeout(timeoutMs);
            let result;
            try {
                result = await adapter.generateImage({ ...input, signal: AbortSignal.any([cancel, deadline]) });
            } catch (error) {
                throw toProviderFailure(error, deadline.aborted, timeoutMs);
            } finally {
                transport.close();
            }

            const { saved, failures } = await saveImages(result.images, directories, characterName, cancel);
            cancel.throwIfAborted();
            if (!saved.length) {
                throw failures[0] ?? new ImageGenerationError(502, 'provider-response-invalid', 'The image provider returned no images.', 'unknown');
            }
            if (failures.length) {
                console.warn(`${LOG_PREFIX} Request ${record.requestId} saved ${saved.length} of ${saved.length + failures.length} images: ${failures.map(failure => failure.reason || failure.code).join(', ')}`);
            }
            if (record.status !== 'pending') {
                return;
            }
            const elapsedMs = now() - record.startedAt;
            record.status = 'completed';
            record.finishedAt = now();
            record.result = {
                requestId: record.requestId,
                status: 'completed',
                images: saved,
                provider: record.provider,
                model: record.model,
                elapsedMs,
                incomplete: failures.length,
            };
            console.info(`${LOG_PREFIX} Request ${record.requestId} completed: provider=${record.provider}, model=${truncateForLog(record.model)}, images=${saved.length}, elapsedMs=${elapsedMs}`);
        } catch (error) {
            if (record.status !== 'pending') {
                return;
            }
            // Anything unexpected after the provider answered happened while saving the paid result.
            const failure = error instanceof ImageGenerationError
                ? error
                : new ImageGenerationError(500, 'save-failed', 'The generated image could not be saved.', 'charged', { reason: describeCode(error) });
            record.status = 'failed';
            record.finishedAt = now();
            record.failure = failure;
            logFailure(record, failure);
        } finally {
            if (state.active === record) {
                state.active = null;
            }
            record.settle();
        }
    }

    router.post('/capabilities', (request, response) => {
        try {
            const body = requireBody(request.body);
            const target = readTarget(body);
            const secretId = readOptionalString(body.secretId, 'secretId');
            const keySaved = readImageKey(request.user.directories, secretId) !== '';
            return sendJson(response, 200, {
                supported: target.capability.supported === true,
                ...(target.capability.supported ? {} : { reason: target.capability.reason }),
                provider: target.provider,
                api: target.capability.api ?? null,
                parameters: target.parameters,
                limits: target.limits,
                requiresBaseUrl: target.requiresBaseUrl,
                requiresKey: PROVIDERS[target.provider].requiresKey,
                keySaved,
            });
        } catch (error) {
            return sendFailure(response, error);
        }
    });

    router.post('/generate', async (request, response) => {
        /** @type {GenerationRecord} */
        let record;
        let job;
        try {
            const handle = getHandle(request);
            job = readGenerationRequest(requireBody(request.body));
            const state = getUserState(handle);

            // Retries must never bill twice: a known id answers from its record.
            const existing = state.records.get(job.requestId);
            if (existing) {
                return sendRecord(response, existing);
            }
            if (state.active) {
                throw new ImageGenerationError(409, 'image-generation-busy', 'Another image generation request is still running.', 'not-charged');
            }

            const apiKey = readImageKey(request.user.directories, job.secretId);
            if (!apiKey && (job.secretId || PROVIDERS[job.provider].requiresKey)) {
                throw new ImageGenerationError(400, 'secret-missing', job.secretId ? 'The selected image generation key was not found.' : 'No image generation key is saved.', 'not-charged');
            }

            const connection = {
                provider: job.provider,
                type: 'image',
                model: job.model,
                ...(job.baseUrl ? { baseUrl: job.baseUrl } : {}),
                ...(apiKey ? { apiKey } : {}),
                timeoutMs,
            };
            let transport;
            let adapter;
            try {
                // 'global' routes requests through the main HTTP agents so requestProxy and privateAddressWhitelist apply.
                transport = createConnectionFetch(connection, { ...(fetch ? { fetch } : {}), agent: 'global' });
                adapter = createAuxiliaryAdapter(connection, { fetch: transport.fetch, errorDetail: true });
            } catch (error) {
                transport?.close();
                throw new ImageGenerationError(400, 'invalid-request', 'Invalid image provider configuration.', 'not-charged', { reason: describeCode(error) });
            }

            let settle;
            const finished = new Promise(resolve => { settle = resolve; });
            record = {
                requestId: job.requestId,
                status: 'pending',
                provider: job.provider,
                model: job.model,
                startedAt: now(),
                finishedAt: null,
                controller: new AbortController(),
                result: null,
                failure: null,
                finished,
                settle,
            };
            state.records.set(record.requestId, record);
            state.active = record;
            prune(state);

            const input = { prompt: job.prompt, ...job.parameters };
            void runGeneration(state, record, { adapter, transport, input, directories: request.user.directories, characterName: job.characterName });
        } catch (error) {
            if (error instanceof ImageGenerationError) {
                const reason = error.reason ? ` (${error.reason})` : '';
                console.warn(`${LOG_PREFIX} Request ${job?.requestId ?? '-'} rejected: provider=${job?.provider ?? '-'}, model=${truncateForLog(job?.model ?? '-')}, error=${error.code}${reason}, elapsedMs=0`);
            }
            return sendFailure(response, error);
        }

        // Deliberately not bound to the client connection: a disconnect leaves the generation running (design D5).
        await record.finished;
        return sendRecord(response, record);
    });

    router.get('/requests/:requestId', (request, response) => {
        try {
            const requestId = readRequestId(request.params.requestId);
            const record = findUserState(getHandle(request))?.records.get(requestId);
            if (!record) {
                return sendJson(response, 404, { error: 'request-not-found', message: 'No image generation request with this id is known.', outcome: 'unknown' });
            }
            return sendJson(response, 200, describeRecord(record));
        } catch (error) {
            return sendFailure(response, error);
        }
    });

    router.post('/cancel', (request, response) => {
        try {
            const requestId = readRequestId(requireBody(request.body).requestId);
            const state = findUserState(getHandle(request));
            const record = state?.records.get(requestId);
            if (!record) {
                return sendJson(response, 404, { error: 'request-not-found', message: 'No image generation request with this id is known.', outcome: 'unknown' });
            }
            if (record.status === 'pending') {
                cancelRecord(state, record);
            }
            switch (record.status) {
                case 'cancelled':
                    // The provider may already have started, and billed, the generation.
                    return sendJson(response, 200, { requestId, status: 'cancelled', outcome: 'unknown' });
                case 'completed':
                    return sendJson(response, 200, record.result);
                default:
                    return sendJson(response, 200, describeRecord(record));
            }
        } catch (error) {
            return sendFailure(response, error);
        }
    });

    return router;
}

export const router = createImageGenerationRouter();

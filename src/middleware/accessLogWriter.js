import path from 'node:path';
import fs from 'node:fs';
import { getIpAddress } from '../express-common.js';
import { getConfigValue } from '../util.js';

const enableAccessLog = getConfigValue('logging.enableAccessLog', true, 'boolean');
const LOG_ROOT = '/var/logs/SillyTavern';
const ACCESS_LOG_FILE = 'access.log';
const ERROR_LOG_FILE = 'error.log';
const LOG_RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ERROR_LOGGED = Symbol('backendErrorLogged');
const BACKEND_PATHS = new Set(['/api', '/csrf-token', '/thumbnail', '/version']);
const BACKEND_PATH_PREFIXES = ['/api/', '/proxy/'];

function padDatePart(value) {
    return value.toString().padStart(2, '0');
}

export function formatDateDirectory(date = new Date()) {
    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export const getLogRootPath = () => LOG_ROOT;
export const getLogDirectory = (date = new Date(), logRoot = LOG_ROOT) => path.join(logRoot, formatDateDirectory(date));
export const getAccessLogPath = (date = new Date(), logRoot = LOG_ROOT) => path.join(getLogDirectory(date, logRoot), ACCESS_LOG_FILE);
export const getErrorLogPath = (date = new Date(), logRoot = LOG_ROOT) => path.join(getLogDirectory(date, logRoot), ERROR_LOG_FILE);

function parseDateDirectory(directoryName) {
    if (!DATE_DIRECTORY_PATTERN.test(directoryName)) {
        return null;
    }

    const [year, month, day] = directoryName.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function getRetentionCutoff(now) {
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    cutoff.setTime(cutoff.getTime() - LOG_RETENTION_DAYS * MS_PER_DAY);
    return cutoff;
}

function stringifyLogEntry(entry) {
    return `${JSON.stringify(entry)}\n`;
}

function ensureLogDirectory(date = new Date(), logRoot = LOG_ROOT) {
    const logDirectory = getLogDirectory(date, logRoot);
    fs.mkdirSync(logDirectory, { recursive: true });
    return logDirectory;
}

function appendLogEntry(filePath, entry) {
    fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        .then(() => fs.promises.appendFile(filePath, stringifyLogEntry(entry), 'utf8'))
        .catch((error) => {
            console.error('Failed to write backend interface log:', error);
        });
}

function getRequestUser(request) {
    return request.user?.profile?.handle || request.user?.profile?.name || undefined;
}

function getResponseContentLength(response) {
    const contentLength = response.getHeader?.('content-length');
    return contentLength === undefined ? undefined : String(contentLength);
}

export function shouldLogBackendRequestPath(requestPath) {
    return BACKEND_PATHS.has(requestPath) || BACKEND_PATH_PREFIXES.some(prefix => requestPath.startsWith(prefix));
}

export function createAccessLogEntry(request, response, startAt) {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
    return {
        timestamp: new Date().toISOString(),
        type: 'access',
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
        ip: getIpAddress(request, true),
        userAgent: request.headers['user-agent'],
        user: getRequestUser(request),
        contentLength: getResponseContentLength(response),
    };
}

export function createStatusErrorLogEntry(request, response, startAt) {
    const accessEntry = createAccessLogEntry(request, response, startAt);
    return {
        ...accessEntry,
        type: 'error',
        errorType: 'http_status',
        message: `Backend interface completed with status ${response.statusCode}`,
    };
}

export function createUnhandledErrorLogEntry(error, request) {
    return {
        timestamp: new Date().toISOString(),
        type: 'error',
        errorType: 'unhandled_exception',
        method: request.method,
        path: request.path,
        ip: getIpAddress(request, true),
        userAgent: request.headers['user-agent'],
        user: getRequestUser(request),
        message: error?.message || String(error),
        stack: error?.stack,
    };
}

export function cleanupOldLogDirectories(now = new Date(), logRoot = LOG_ROOT) {
    try {
        if (!fs.existsSync(logRoot)) {
            return;
        }

        const cutoff = getRetentionCutoff(now);
        const entries = fs.readdirSync(logRoot, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const directoryDate = parseDateDirectory(entry.name);
            if (!directoryDate || directoryDate >= cutoff) {
                continue;
            }

            fs.rmSync(path.join(logRoot, entry.name), { recursive: true, force: true });
        }
    } catch (error) {
        console.error('Failed to clean old backend interface logs:', error);
    }
}

export function prepareBackendLogStorage(now = new Date(), logRoot = LOG_ROOT) {
    try {
        ensureLogDirectory(now, logRoot);
        cleanupOldLogDirectories(now, logRoot);
    } catch (error) {
        console.error('Failed to prepare backend interface log storage:', error);
    }
}

export function migrateAccessLog(now = new Date(), logRoot = LOG_ROOT) {
    try {
        if (!fs.existsSync('access.log')) {
            return;
        }

        const logDirectory = ensureLogDirectory(now, logRoot);
        const legacyLogPath = path.join(logDirectory, 'access-legacy.log');
        if (fs.existsSync(legacyLogPath)) {
            return;
        }

        fs.renameSync('access.log', legacyLogPath);
        console.log('Migrated legacy access.log to new backend log location:', legacyLogPath);
    } catch (error) {
        console.error('Failed to migrate legacy access log:', error);
        console.info('Please move access.log to the backend log directory manually.');
    }
}

/**
 * Creates middleware for logging backend interface access.
 * @param {{ logRoot?: string }} [options] Logger options.
 * @returns {import('express').RequestHandler}
 */
export default function accessLoggerMiddleware({ logRoot = LOG_ROOT } = {}) {
    return function (req, res, next) {
        if (!enableAccessLog || !shouldLogBackendRequestPath(req.path)) {
            return next();
        }

        const startAt = process.hrtime.bigint();

        res.on('finish', () => {
            const now = new Date();
            appendLogEntry(getAccessLogPath(now, logRoot), createAccessLogEntry(req, res, startAt));

            // Some handlers catch their own errors and return 5xx; log those as interface errors too.
            if (res.statusCode >= 500 && !res.locals[ERROR_LOGGED]) {
                appendLogEntry(getErrorLogPath(now, logRoot), createStatusErrorLogEntry(req, res, startAt));
            }
        });

        next();
    };
}

/**
 * Creates middleware for logging uncaught backend interface errors.
 * @param {{ logRoot?: string }} [options] Logger options.
 * @returns {import('express').ErrorRequestHandler}
 */
export function backendErrorLoggerMiddleware({ logRoot = LOG_ROOT } = {}) {
    return function (error, req, res, next) {
        if (enableAccessLog && shouldLogBackendRequestPath(req.path)) {
            res.locals[ERROR_LOGGED] = true;
            appendLogEntry(getErrorLogPath(new Date(), logRoot), createUnhandledErrorLogEntry(error, req));
        }

        next(error);
    };
}

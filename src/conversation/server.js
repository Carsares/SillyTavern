import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createConversationServices } from './composition/index.js';
import { createRouter } from './api/index.js';
import { requireNewDirectory } from './composition/helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = value => createHash('sha256').update(String(value)).digest();
const equal = (left, right) => timingSafeEqual(digest(left), digest(right));
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostname(value) {
    if (typeof value !== 'string' || !value || /[\s/@?#*\\]/.test(value)) throw new Error('Invalid host name');
    const url = new URL(`http://${value === '::1' ? '[::1]' : value}`);
    if (url.host !== url.hostname || url.pathname !== '/') throw new Error('Host names must not include a port or path');
    return url.hostname;
}
function listenerOptions({ port = 8000, host = '127.0.0.1', password, allowedHosts } = {}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer between 0 and 65535');
    const name = hostname(host);
    if (password !== undefined && (typeof password !== 'string' || !password.trim())) throw new Error('Password must be a nonempty string');
    if (!localHosts.has(name) && !password) throw new Error('A non-local listener requires CONVERSATION_PASSWORD');
    const hosts = allowedHosts ?? [...localHosts, name];
    if (!Array.isArray(hosts) || !hosts.length) throw new Error('At least one allowed host is required');
    return { port, host: name.startsWith('[') ? name.slice(1, -1) : name, password, allowedHosts: hosts.map(hostname) };
}

/** Pure middleware factory for isolated security tests; never opens a listener or data store. */
export function createSecurityMiddleware({ allowedHosts = [...localHosts], password, csrf }) {
    if (!Array.isArray(allowedHosts) || !allowedHosts.length) throw new Error('At least one allowed host is required');
    if (password !== undefined && (typeof password !== 'string' || !password.trim())) throw new Error('Password must be a nonempty string');
    if (typeof csrf !== 'string' || !csrf) throw new Error('A security token is required');
    const hosts = new Set(allowedHosts.map(hostname));
    return (req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', 'default-src \'self\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data: https:; connect-src \'self\'; frame-ancestors \'none\'; base-uri \'none\'; form-action \'self\'');
        let host;
        try {
            const value = req.headers.host;
            if (typeof value !== 'string' || /[\s/@?#*\\]/.test(value)) throw new Error('Invalid host');
            host = new URL(`http://${value}`);
            if (host.pathname !== '/') throw new Error('Invalid host');
        } catch { return res.sendStatus(400); }
        if (!hosts.has(host.hostname)) return res.status(403).json({ error: { code: 'host-denied', message: 'Host is not allowed' } });
        if (password) {
            const authorization = req.get('authorization') ?? '';
            const decoded = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString('utf8') : '';
            if (!decoded.includes(':') || !equal(decoded.slice(decoded.indexOf(':') + 1), password)) {
                res.setHeader('WWW-Authenticate', 'Basic realm="Conversation", charset="UTF-8"');
                return res.sendStatus(401);
            }
        }
        if (req.headers.origin) {
            let origin;
            try { origin = new URL(req.headers.origin); } catch { return res.sendStatus(403); }
            if (origin.host !== host.host || origin.protocol !== (req.secure ? 'https:' : 'http:') || origin.username || origin.password) return res.sendStatus(403);
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !equal(req.get('X-CSRF-Token') ?? '', csrf)) {
            return res.status(403).json({ error: { code: 'csrf', message: 'Request security token is invalid; reload the page' } });
        }
        next();
    };
}

/** Async so setup failure can release the data writer before rejecting. Importing is inert. */
export async function createApplication({ directory = path.join(root, 'data/default-user/conversation-v1'), password,
    allowedHosts = [...localHosts], services: suppliedServices, dependencies = {}, ...options } = {}) {
    directory = requireNewDirectory(directory);
    createSecurityMiddleware({ allowedHosts, password, csrf: 'validation-only' });
    const services = suppliedServices ?? (dependencies.createConversationServices ?? createConversationServices)({ directory, ...options });
    let closing;
    const close = () => { closing ??= Promise.resolve().then(() => services.close()); return closing; };
    try {
        const expressFactory = dependencies.express ?? express;
        const app = expressFactory();
        const csrf = randomBytes(32).toString('hex');
        app.disable('x-powered-by');
        app.use(createSecurityMiddleware({ allowedHosts, password, csrf }));
        app.get('/csrf-token', (_req, res) => res.set('Cache-Control', 'no-store').json({ token: csrf }));
        app.get('/health', (_req, res) => res.json({ status: 'ok', schemaVersion: 1 }));
        app.use('/api/conversation/v1', (dependencies.createRouter ?? createRouter)(services));
        app.get('/', (_req, res) => res.redirect('/modern/conversation/'));
        app.use('/modern/conversation', expressFactory.static(path.join(root, 'public/modern/conversation'), { index: 'index.html', etag: true }));
        app.use('/shared/conversation', expressFactory.static(path.join(root, 'public/shared/conversation'), { etag: true }));
        app.use((_req, res) => res.sendStatus(404));
        app.use((_error, _req, res, _next) => res.status(500).json({ error: { code: 'internal-error', message: 'The operation could not be completed' } }));
        return { app, services, close };
    } catch (error) { await close(); throw error; }
}

export async function startServer({ password = process.env.CONVERSATION_PASSWORD, dependencies = {}, ...options } = {}) {
    const listener = listenerOptions({ ...options, password });
    const application = await (dependencies.createApplication ?? createApplication)({ ...options, ...listener, dependencies });
    let server;
    try {
        server = (dependencies.createServer ?? http.createServer)(application.app);
        server.requestTimeout = 30000;
        server.headersTimeout = 10000;
        server.maxHeadersCount = 100;
        await new Promise((resolve, reject) => {
            const failed = error => { server.removeListener('listening', ready); reject(error); };
            const ready = () => { server.removeListener('error', failed); resolve(); };
            server.once('error', failed); server.once('listening', ready);
            server.listen(listener.port, listener.host);
        });
    } catch (error) { server?.closeAllConnections(); await application.close(); throw error; }
    let closing;
    return { ...application, server, address: server.address(), close() {
        closing ??= (async () => {
            const stopped = new Promise(resolve => server.close(error => resolve(error)));
            let failure;
            try { await application.close(); } catch (error) { failure = error; } finally { server.closeAllConnections(); }
            const serverError = await stopped;
            if (failure || serverError) throw failure ?? serverError;
        })();
        return closing;
    } };
}

export function parseArguments(args) {
    const options = {};
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--listen') { options.host = '0.0.0.0'; continue; }
        if (!['--port', '--host', '--dataRoot', '--allowed-host'].includes(flag)) throw new Error(`Unsupported argument: ${flag}`);
        const value = args[++i];
        if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
        if (flag === '--port') {
            if (!/^\d+$/.test(value)) throw new Error('Port must be an integer between 0 and 65535');
            options.port = Number(value);
        } else if (flag === '--host') { hostname(value); options.host = value; } else if (flag === '--dataRoot') options.directory = path.resolve(value, 'default-user/conversation-v1');
        else (options.allowedHosts ??= [...localHosts]).push(hostname(value));
    }
    if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) throw new Error('Port must be an integer between 0 and 65535');
    return options;
}

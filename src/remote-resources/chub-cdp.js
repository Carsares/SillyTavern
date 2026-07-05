import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

import WebSocket from 'ws';

const DEFAULT_TIMEOUT_MS = 30000;
const CHUB_BASE_URL = 'https://chub.ai';
const RO_BASE_URL = 'https://ro.chub.ai';
const CHUB_SEARCH_API = `${RO_BASE_URL}/search`;
const CHROME_CANDIDATES = Object.freeze({
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/opt/google/chrome/chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
    ],
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
});

export async function searchChubViaCdp(params, context = {}) {
    const namespaces = namespacesForResourceType(params.resourceType);
    if (!namespaces.length) {
        return { items: [], total: 0 };
    }

    const browser = await openChubBrowser(context.directories);
    let browserConnection;

    try {
        const version = await cdpJson(browser.baseUrl, '/json/version');
        if (!version.webSocketDebuggerUrl) {
            throw new Error('Chrome CDP browser websocket is unavailable.');
        }

        browserConnection = new CdpConnection(version.webSocketDebuggerUrl);
        await browserConnection.ready;
        if (context.cookie) {
            await injectChubCookies(browserConnection, context.cookie);
        }

        const results = [];
        let total = 0;
        for (const namespace of namespaces) {
            const payload = await searchChubNamespace(browser.baseUrl, browserConnection, namespace, params);
            const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [];
            results.push(...nodes.map(node => convertChubNode(node, namespace)).filter(Boolean));
            total += Number(payload?.data?.count) || nodes.length;
        }

        return { items: results, total };
    } finally {
        if (browserConnection) {
            browserConnection.close();
        }
        await browser.close();
    }
}

async function searchChubNamespace(baseUrl, browserConnection, namespace, params) {
    const target = await createTarget(baseUrl, browserConnection, 'about:blank');
    const page = new CdpConnection(target.webSocketDebuggerUrl);

    try {
        await page.ready;
        await page.send('Page.enable');
        await page.send('Runtime.enable');
        await page.send('Network.enable');

        const payloadPromise = waitForSearchPayload(page, namespace, Number(params.timeoutMs) || DEFAULT_TIMEOUT_MS);
        await page.send('Page.navigate', { url: buildSearchPageUrl(namespace, params) });
        return await payloadPromise;
    } finally {
        page.close();
        await browserConnection.send('Target.closeTarget', { targetId: target.id }).catch(() => {});
    }
}

function waitForSearchPayload(page, namespace, timeoutMs) {
    const candidateRequests = new Set();
    let settled = false;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(new Error(`Timed out waiting for Chub ${namespace} search response.`));
        }, timeoutMs);

        page.on('Network.responseReceived', event => {
            const response = event.params?.response;
            const url = response?.url || '';
            if (!url.startsWith(CHUB_SEARCH_API) || !url.includes(`namespace=${namespace}`) || Number(response?.status) !== 200) {
                return;
            }
            candidateRequests.add(event.params.requestId);
        });

        page.on('Network.loadingFinished', async event => {
            const requestId = event.params?.requestId;
            if (!candidateRequests.has(requestId) || settled) {
                return;
            }

            try {
                const body = await page.send('Network.getResponseBody', { requestId });
                const payload = JSON.parse(body.body || '{}');
                if (!Array.isArray(payload?.data?.nodes)) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(payload);
            } catch {
                // Chub emits an extra search-looking response with no retrievable body.
                // Keep waiting for the JSON response that the frontend actually consumes.
            }
        });

        page.on('Network.loadingFailed', event => {
            candidateRequests.delete(event.params?.requestId);
        });
    });
}

async function openChubBrowser(directories) {
    const configuredUrl = String(process.env.SILLYTAVERN_CHUB_CDP_URL || '').trim();
    if (configuredUrl) {
        if (!(await isCdpAlive(configuredUrl))) {
            throw new Error(`Chub CDP endpoint is unavailable: ${configuredUrl}`);
        }
        return { baseUrl: configuredUrl, close: async () => {} };
    }

    const chromePath = resolveChromePath();
    const port = await resolveCdpPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    if (await isCdpAlive(baseUrl)) {
        throw new Error(`Chub CDP port ${port} is already occupied by another Chrome instance.`);
    }

    const profile = resolveProfileDir(directories);
    const args = [
        '--headless=new',
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile.path}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
    ];

    fs.mkdirSync(profile.path, { recursive: true });
    const child = spawn(chromePath, args, { stdio: 'ignore', detached: true });
    child.unref();

    const ready = await waitForCdp(baseUrl, DEFAULT_TIMEOUT_MS);
    if (!ready) {
        stopProcess(child.pid);
        await waitForProcessExit(child, 3000);
        cleanupProfile(profile);
        throw new Error(`Chrome did not expose CDP at ${baseUrl}. Set SILLYTAVERN_CHUB_CDP_URL to a running Chrome endpoint if auto-launch is unavailable.`);
    }

    return {
        baseUrl,
        close: async () => closeLaunchedBrowser(baseUrl, child, profile),
    };
}

async function resolveCdpPort() {
    const configured = String(process.env.SILLYTAVERN_CHUB_CDP_PORT || '').trim();
    if (configured) {
        const port = Number(configured);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error(`Invalid Chub CDP port: ${configured}`);
        }
        return port;
    }
    return await getFreePort();
}

function resolveChromePath() {
    const configured = String(process.env.SILLYTAVERN_CHUB_CHROME_PATH || '').trim();
    if (configured) {
        if (!fs.existsSync(configured)) {
            throw new Error(`Configured Chub Chrome path does not exist: ${configured}`);
        }
        return configured;
    }

    for (const candidate of CHROME_CANDIDATES[process.platform] || []) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error('Chrome executable not found. Set SILLYTAVERN_CHUB_CHROME_PATH or SILLYTAVERN_CHUB_CDP_URL for Chub search.');
}

function resolveProfileDir(directories) {
    const configured = String(process.env.SILLYTAVERN_CHUB_CDP_PROFILE || '').trim();
    if (configured) {
        return { path: path.resolve(configured), temporary: false };
    }
    const root = directories?.root || path.join(os.tmpdir(), 'sillytavern');
    const parent = path.join(root, 'remote-resources');
    fs.mkdirSync(parent, { recursive: true });
    return { path: fs.mkdtempSync(path.join(parent, 'chub-headless-')), temporary: true };
}

async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(address.port);
            });
        });
    });
}

async function closeLaunchedBrowser(baseUrl, child, profile) {
    let closed = false;
    try {
        const version = await cdpJson(baseUrl, '/json/version');
        if (version.webSocketDebuggerUrl) {
            const connection = new CdpConnection(version.webSocketDebuggerUrl);
            await connection.ready;
            await connection.send('Browser.close').catch(() => {});
            connection.close();
            closed = await waitForCdpDown(baseUrl, 5000);
        }
    } catch {
        // Browser.close can fail if Chrome exits first; the child pid is the final authority.
    }

    if (!closed) {
        stopProcess(child.pid);
        await waitForProcessExit(child, 3000);
    }
    cleanupProfile(profile);
}

function cleanupProfile(profile) {
    if (!profile.temporary) {
        return;
    }
    fs.rmSync(profile.path, { recursive: true, force: true });
}

async function createTarget(baseUrl, browserConnection, url) {
    const result = await browserConnection.send('Target.createTarget', { url });
    const targetId = result.targetId;
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
        const targets = await cdpJson(baseUrl, '/json/list');
        const target = Array.isArray(targets) ? targets.find(item => item.id === targetId) : null;
        if (target?.webSocketDebuggerUrl) {
            return target;
        }
        await delay(100);
    }

    throw new Error(`Chrome CDP target ${targetId} was not listed.`);
}

async function injectChubCookies(browserConnection, rawCookie) {
    const cookies = parseCookieCredential(rawCookie);
    if (!cookies.length) {
        return;
    }

    await browserConnection.send('Storage.setCookies', { cookies });
}

function parseCookieCredential(rawCookie) {
    const trimmed = String(rawCookie || '').trim();
    if (!trimmed) {
        return [];
    }

    const parsed = parseCookieJson(trimmed);
    if (parsed) {
        return parsed;
    }

    return trimmed
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .flatMap(part => {
            const index = part.indexOf('=');
            if (index <= 0) {
                return [];
            }
            const name = part.slice(0, index).trim();
            const value = part.slice(index + 1).trim();
            if (!name || !value) {
                return [];
            }
            return [
                { name, value, url: CHUB_BASE_URL },
                { name, value, url: RO_BASE_URL },
            ];
        });
}

function parseCookieJson(trimmed) {
    try {
        const json = JSON.parse(trimmed);
        if (!Array.isArray(json)) {
            return null;
        }

        return json
            .filter(item => item && typeof item === 'object' && item.name && item.value)
            .map(item => {
                const cookie = {
                    name: String(item.name),
                    value: String(item.value),
                    path: item.path ? String(item.path) : '/',
                };
                if (item.domain) {
                    cookie.domain = String(item.domain);
                } else if (item.url) {
                    cookie.url = String(item.url);
                } else {
                    cookie.url = CHUB_BASE_URL;
                }
                if (item.expires) {
                    cookie.expires = Number(item.expires);
                }
                if (item.httpOnly !== undefined) {
                    cookie.httpOnly = Boolean(item.httpOnly);
                }
                if (item.secure !== undefined) {
                    cookie.secure = Boolean(item.secure);
                }
                if (item.sameSite) {
                    cookie.sameSite = String(item.sameSite);
                }
                return cookie;
            });
    } catch {
        return null;
    }
}

function buildSearchPageUrl(namespace, params) {
    const url = new URL(`${CHUB_BASE_URL}/${namespace}`);
    const query = String(params.query || '').trim();
    if (query) {
        url.searchParams.set('search', query);
    }
    return url.toString();
}

function namespacesForResourceType(resourceType) {
    if (!resourceType) {
        return ['characters', 'lorebooks'];
    }
    if (resourceType === 'character') {
        return ['characters'];
    }
    if (resourceType === 'worldbook') {
        return ['lorebooks'];
    }
    return [];
}

function convertChubNode(node, namespace) {
    const fullPath = String(node?.fullPath || '').trim();
    if (!fullPath) {
        return null;
    }

    const resourceType = namespace === 'lorebooks' ? 'worldbook' : 'character';
    const urlPath = namespace === 'lorebooks' ? fullPath.replace(/^lorebooks\//, '') : fullPath;
    return {
        id: fullPath,
        resourceType,
        title: String(node.name || fullPath),
        description: String(node.tagline || node.description || ''),
        author: getAuthorFromFullPath(fullPath, namespace),
        sourceUrl: `${CHUB_BASE_URL}/${namespace}/${urlPath}`,
        downloadUrl: `${CHUB_BASE_URL}/${namespace}/${urlPath}`,
        thumbnailUrl: node.avatar_url || node.max_res_url || '',
        tags: Array.isArray(node.topics) ? node.topics : [],
        stats: {
            stars: Number(node.starCount) || 0,
            forks: Number(node.forksCount) || 0,
            tokens: Number(node.nTokens) || 0,
        },
        updatedAt: node.lastActivityAt || node.createdAt || '',
        capabilities: { download: true, importUrl: true },
        metadata: {
            chubId: node.id || '',
            fullPath,
            projectSpace: node.projectSpace || namespace,
            rating: node.rating || '',
        },
    };
}

function getAuthorFromFullPath(fullPath, namespace) {
    const parts = fullPath.split('/').filter(Boolean);
    if (namespace === 'lorebooks' && parts[0] === 'lorebooks') {
        return parts[1] || '';
    }
    return parts[0] || '';
}

async function isCdpAlive(baseUrl) {
    try {
        await cdpJson(baseUrl, '/json/version', 2000);
        return true;
    } catch {
        return false;
    }
}

async function waitForCdp(baseUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isCdpAlive(baseUrl)) {
            return true;
        }
        await delay(250);
    }
    return false;
}

async function waitForCdpDown(baseUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!(await isCdpAlive(baseUrl))) {
            return true;
        }
        await delay(250);
    }
    return false;
}

async function cdpJson(baseUrl, pathName, timeoutMs = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}${pathName}`, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`CDP HTTP ${pathName} failed: ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function stopProcess(pid) {
    if (!pid) {
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        // The Chrome process may already have exited after Browser.close.
    }
}

function waitForProcessExit(child, timeoutMs) {
    if (!child || child.exitCode !== null || child.signalCode) {
        return Promise.resolve(true);
    }

    return new Promise(resolve => {
        const timer = setTimeout(() => {
            child.off('exit', onExit);
            resolve(false);
        }, timeoutMs);
        const onExit = () => {
            clearTimeout(timer);
            resolve(true);
        };
        child.once('exit', onExit);
    });
}

class CdpConnection {
    constructor(webSocketUrl) {
        this.webSocket = new WebSocket(webSocketUrl);
        this.nextId = 0;
        this.pending = new Map();
        this.handlers = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.webSocket.once('open', resolve);
            this.webSocket.once('error', reject);
        });
        this.webSocket.on('message', message => this.handleMessage(message));
        this.webSocket.on('close', () => this.rejectPending(new Error('Chrome CDP websocket closed.')));
        this.webSocket.on('error', error => this.rejectPending(error));
    }

    on(method, handler) {
        const handlers = this.handlers.get(method) || [];
        handlers.push(handler);
        this.handlers.set(method, handlers);
    }

    async send(method, params = {}) {
        await this.ready;
        const id = ++this.nextId;
        const payload = JSON.stringify({ id, method, params });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP ${method} timed out.`));
            }, DEFAULT_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer, method });
            this.webSocket.send(payload, error => {
                if (error) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    reject(error);
                }
            });
        });
    }

    close() {
        this.webSocket.close();
    }

    handleMessage(message) {
        const data = JSON.parse(message.toString());
        if (data.id) {
            const pending = this.pending.get(data.id);
            if (!pending) {
                return;
            }
            clearTimeout(pending.timer);
            this.pending.delete(data.id);
            if (data.error) {
                pending.reject(new Error(`CDP ${pending.method} failed: ${JSON.stringify(data.error)}`));
            } else {
                pending.resolve(data.result || {});
            }
            return;
        }

        const handlers = this.handlers.get(data.method) || [];
        for (const handler of handlers) {
            handler(data);
        }
    }

    rejectPending(error) {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }
}

import { BRIDGE_SOURCE, BRIDGE_TIMEOUTS } from './bridge-protocol.js';

export function createLegacyBridge({
    source = BRIDGE_SOURCE,
    frameSrc = '/index.html?modernBridge=1',
    frameTitle = 'SillyTavern legacy generation engine',
    origin = window.location.origin,
    loadTimeoutMs = BRIDGE_TIMEOUTS.LOAD,
    defaultTimeoutMs = BRIDGE_TIMEOUTS.DEFAULT,
} = {}) {
    const bridge = {
        frame: null,
        loadPromise: null,
        pending: new Map(),
        nextId: 1,
    };

    function handleMessage(event) {
        if (event.origin !== origin || event.data?.source !== source) {
            return;
        }

        const request = bridge.pending.get(event.data.id);
        if (!request) {
            return;
        }

        window.clearTimeout(request.timer);
        bridge.pending.delete(event.data.id);
        if (event.data.error) {
            request.reject(new Error(event.data.error.message || '生成引擎执行失败。'));
            return;
        }
        request.resolve(event.data.result);
    }

    window.addEventListener('message', handleMessage);

    async function ensureFrame() {
        if (bridge.loadPromise) {
            return bridge.loadPromise;
        }
        if (bridge.frame?.contentWindow) {
            return bridge.frame;
        }

        bridge.loadPromise = new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            const timer = window.setTimeout(() => {
                reject(new Error('生成引擎加载超时。'));
            }, loadTimeoutMs);

            frame.hidden = true;
            frame.title = frameTitle;
            frame.src = frameSrc;
            frame.style.display = 'none';
            frame.addEventListener('load', () => {
                window.clearTimeout(timer);
                resolve(frame);
            }, { once: true });
            frame.addEventListener('error', () => {
                window.clearTimeout(timer);
                reject(new Error('生成引擎加载失败。'));
            }, { once: true });

            bridge.frame = frame;
            document.body.append(frame);
        });

        try {
            return await bridge.loadPromise;
        } catch (error) {
            bridge.frame?.remove();
            bridge.frame = null;
            bridge.loadPromise = null;
            throw error;
        }
    }

    async function callLegacyBridge(action, payload = {}, timeoutMs = defaultTimeoutMs) {
        const frame = await ensureFrame();
        const id = String(bridge.nextId++);

        const responsePromise = new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                bridge.pending.delete(id);
                reject(new Error('生成引擎响应超时。'));
            }, timeoutMs);
            bridge.pending.set(id, { resolve, reject, timer });
        });

        frame.contentWindow.postMessage({
            source,
            id,
            action,
            payload,
        }, origin);

        return responsePromise;
    }

    function disposeLegacyBridge() {
        window.removeEventListener('message', handleMessage);
        bridge.pending.forEach(request => window.clearTimeout(request.timer));
        bridge.pending.clear();
        bridge.frame?.remove();
        bridge.frame = null;
        bridge.loadPromise = null;
    }

    return {
        callLegacyBridge,
        disposeLegacyBridge,
    };
}

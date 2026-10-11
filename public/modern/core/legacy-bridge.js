import { BRIDGE_EVENTS, BRIDGE_SOURCE, BRIDGE_TIMEOUTS } from './bridge-protocol.js';

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
        progressSubscribers: new Set(),
        nextId: 1,
    };

    function handleMessage(event) {
        if (event.origin !== origin || event.data?.source !== source) {
            return;
        }

        // 单向流式增量事件（无 id、无响应）：按 event 字段分发给订阅者，不走 pending 请求匹配。
        if (event.data.event === BRIDGE_EVENTS.STREAM_PROGRESS) {
            bridge.progressSubscribers.forEach((callback) => {
                try {
                    callback(event.data);
                } catch (error) {
                    console.warn('Bridge progress subscriber failed', error);
                }
            });
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

    // 订阅 legacy 侧的单向流式增量；返回取消订阅函数。生成期间订阅、结束即取消，避免累积。
    function subscribeProgress(callback) {
        bridge.progressSubscribers.add(callback);
        return () => bridge.progressSubscribers.delete(callback);
    }

    function disposeLegacyBridge() {
        window.removeEventListener('message', handleMessage);
        bridge.pending.forEach(request => window.clearTimeout(request.timer));
        bridge.pending.clear();
        bridge.progressSubscribers.clear();
        bridge.frame?.remove();
        bridge.frame = null;
        bridge.loadPromise = null;
    }

    return {
        callLegacyBridge,
        subscribeProgress,
        disposeLegacyBridge,
    };
}

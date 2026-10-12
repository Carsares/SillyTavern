// 设置中心「改动即保存」的公共部分：字段改动后立即写入 settings.json，再让隐藏的生成引擎重载设置。
//
// - commit({ changes })：changes 是一组 [路径, 值]，路径用数组（例如 ['oai_settings', 'temp_openai']）。
//   先改 state.settings 再整体保存；保存失败时把这些路径恢复成改动前的值，不留下半截修改。
// - 引擎重载合并执行：上一次还没结束时只记一笔，结束后再重载一次，连续改多个字段只多出一次重载。
// - 状态写在 state.settingsAutosave，页头的状态标签（renderSettingsSaveStatus）就地更新，不重绘整页。
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

/**
 * @typedef {'idle' | 'saving' | 'saved' | 'warning' | 'error'} AutosavePhase
 * @typedef {{ phase: AutosavePhase, message: string, detail: string, at: number }} AutosaveStatus
 * @typedef {Array<[string[], unknown]>} SettingsChanges
 */

const STATUS_SELECTOR = '[data-settings-save-status]';

/**
 * @param {Record<string, any>} target 对象
 * @param {string[]} path 路径
 * @returns {{ exists: boolean, value: unknown }} 当前值
 */
function readPath(target, path) {
    let node = target;
    for (const key of path.slice(0, -1)) {
        if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) {
            return { exists: false, value: undefined };
        }
        node = node[key];
    }
    const last = path[path.length - 1];
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, last)) {
        return { exists: false, value: undefined };
    }
    return { exists: true, value: structuredClone(node[last]) };
}

/**
 * 写入路径，中间缺的对象自动建出来。
 * @param {Record<string, any>} target 对象
 * @param {string[]} path 路径
 * @param {unknown} value 值
 */
export function writeSettingsPath(target, path, value) {
    let node = target;
    for (const key of path.slice(0, -1)) {
        if (!node[key] || typeof node[key] !== 'object') {
            node[key] = {};
        }
        node = node[key];
    }
    node[path[path.length - 1]] = value;
}

/**
 * @param {Record<string, any>} target 对象
 * @param {string[]} path 路径
 */
function deletePath(target, path) {
    let node = target;
    for (const key of path.slice(0, -1)) {
        if (!node || typeof node !== 'object') {
            return;
        }
        node = node[key];
    }
    if (node && typeof node === 'object') {
        delete node[path[path.length - 1]];
    }
}

/**
 * 名称和后面的中文连写；名称以字母或数字结尾时（例如「主 API」「API Key」）中间加一个空格。
 * @param {string} label 名称
 * @param {string} suffix 后缀，例如「已保存」
 * @returns {string} 文字
 */
function withSuffix(label, suffix) {
    return /[A-Za-z0-9]$/.test(label) ? `${label} ${suffix}` : `${label}${suffix}`;
}

/**
 * @param {number} time 时间戳
 * @returns {string} 时:分:秒
 */
function formatClock(time) {
    return new Date(time).toLocaleTimeString('zh-CN', { hour12: false });
}

/**
 * 状态标签的文字、图标和样式。
 * @param {AutosaveStatus} status 状态
 * @returns {{ text: string, icon: string, className: string }} 视图
 */
function describeStatus(status) {
    switch (status.phase) {
        case 'saving':
            return { text: status.message || '保存中…', icon: 'fa-circle-notch fa-spin', className: '' };
        case 'saved':
            return { text: `${status.message || '已保存'} · ${formatClock(status.at)}`, icon: 'fa-circle-check', className: 'is-saved' };
        case 'warning':
            return { text: status.message, icon: 'fa-triangle-exclamation', className: 'is-warning' };
        case 'error':
            return { text: status.message, icon: 'fa-circle-xmark', className: 'is-error' };
        default:
            return { text: '改动会自动保存', icon: 'fa-cloud', className: '' };
    }
}

/**
 * 页头的保存状态标签。
 * @param {AutosaveStatus | undefined} status state.settingsAutosave
 * @param {(value: unknown) => string} escapeHtml 转义函数
 * @returns {string} HTML
 */
export function renderSettingsSaveStatus(status, escapeHtml) {
    const view = describeStatus(status || { phase: 'idle', message: '', detail: '', at: 0 });
    return `
        <span class="settings-save-status ${view.className}" data-settings-save-status role="status" aria-live="polite" title="${escapeHtml(status?.detail || '')}">
            <i class="fa-solid ${view.icon}" aria-hidden="true"></i>
            <span data-settings-save-status-text>${escapeHtml(view.text)}</span>
        </span>
    `;
}

/**
 * 合并执行的保存：上一次还在进行时只记一笔，结束后再跑一次。用于每次都读取整张表单的保存动作
 * （翻译、摘要），保证最后一次改动一定会被保存，又不会并发写。触发函数上的 idle() 等到当前这轮（含补跑）结束。
 * @template T
 * @param {() => Promise<T>} task 保存动作
 * @returns {(() => Promise<T>) & { idle: () => Promise<unknown> }} 触发函数
 */
export function createCoalescedRunner(task) {
    /** @type {Promise<T> | null} */
    let running = null;
    let again = false;
    run.idle = () => (running ? running.catch(() => {}) : Promise.resolve());
    return run;

    function run() {
        if (running) {
            again = true;
            return running;
        }
        running = (async () => {
            let result;
            do {
                again = false;
                result = await task();
            } while (again);
            return result;
        })().finally(() => {
            running = null;
        });
        return running;
    }
}

/**
 * @param {object} options 依赖
 * @param {any} options.state 页面状态
 * @param {(path: string, options?: object) => Promise<any>} options.apiFetch 请求函数
 * @param {(title: string, message: string) => void} options.showToast 提示
 * @param {() => Promise<any>} [options.reloadSettings] 让生成引擎重载设置，永不 reject
 */
export function createSettingsAutosave({ state, apiFetch, showToast, reloadSettings = noEngineSync }) {
    /** @type {Set<Promise<unknown>>} */
    const pending = new Set();
    /** @type {Promise<any> | null} */
    let engineRun = null;
    let engineAgain = false;

    /** @returns {AutosaveStatus} 状态 */
    function getStatus() {
        state.settingsAutosave ??= { phase: 'idle', message: '', detail: '', at: 0 };
        return state.settingsAutosave;
    }

    /**
     * @param {AutosavePhase} phase 阶段
     * @param {string} message 文字
     * @param {string} [detail] 鼠标悬停时显示的详情
     */
    function setStatus(phase, message, detail = '') {
        Object.assign(getStatus(), { phase, message, detail, at: Date.now() });
        paintStatus();
    }

    // 只改页头标签本身，不重绘页面，正在输入的字段不受影响
    function paintStatus() {
        if (typeof document === 'undefined') {
            return;
        }
        const element = document.querySelector(STATUS_SELECTOR);
        if (!(element instanceof HTMLElement)) {
            return;
        }
        const status = getStatus();
        const view = describeStatus(status);
        element.className = `settings-save-status ${view.className}`;
        element.title = status.detail || '';
        const icon = element.querySelector('i');
        if (icon) {
            icon.className = `fa-solid ${view.icon}`;
        }
        const text = element.querySelector('[data-settings-save-status-text]');
        if (text) {
            text.textContent = view.text;
        }
    }

    /**
     * @template T
     * @param {Promise<T>} promise 在途操作
     * @returns {Promise<T>} 同一个 Promise
     */
    function track(promise) {
        pending.add(promise);
        promise.finally(() => pending.delete(promise)).catch(() => {});
        return promise;
    }

    // 合并执行的引擎重载：在途时只记一笔，结束后补一次
    function syncEngine() {
        if (engineRun) {
            engineAgain = true;
            return engineRun;
        }
        engineRun = (async () => {
            let result;
            do {
                engineAgain = false;
                result = await reloadSettings();
            } while (engineAgain);
            return result;
        })().then(result => {
            const failure = describeReloadFailure(result);
            if (failure && getStatus().phase === 'saved') {
                setStatus('warning', '已保存，但生成引擎未同步', failure.replace(/^（|）$/g, ''));
            }
            return result;
        }).finally(() => {
            engineRun = null;
        });
        return track(engineRun);
    }

    /**
     * 改设置并保存。
     * @param {{ changes: SettingsChanges, label?: string, syncEngine?: boolean }} options 改动、提示用的名称、是否通知引擎
     * @returns {Promise<{ ok: boolean, unchanged?: boolean, error?: Error }>} 结果；unchanged 表示值和已保存的一样，没有写入
     */
    function commit({ changes, label = '设置', syncEngine: shouldSyncEngine = true }) {
        const settings = state.settings;
        const previous = changes.map(([path]) => ({ path, ...readPath(settings, path) }));
        // 值和已保存的一样（例如按回车保存后又失焦）就不再写一次
        if (previous.every((item, index) => item.exists && JSON.stringify(item.value) === JSON.stringify(changes[index][1]))) {
            return Promise.resolve({ ok: true, unchanged: true });
        }
        for (const [path, value] of changes) {
            writeSettingsPath(settings, path, value);
        }
        setStatus('saving', `正在保存${label}…`);
        return track((async () => {
            try {
                await saveSettingsSerialized(apiFetch, settings);
            } catch (error) {
                // 倒序恢复：同一路径写过多次时，最后留下的是改动前的值
                for (const item of [...previous].reverse()) {
                    if (item.exists) {
                        writeSettingsPath(settings, item.path, item.value);
                    } else {
                        deletePath(settings, item.path);
                    }
                }
                setStatus('error', withSuffix(label, '保存失败'), error.message);
                showToast(withSuffix(label, '保存失败'), error.message);
                return { ok: false, error };
            }
            setStatus('saved', withSuffix(label, '已保存'));
            if (shouldSyncEngine) {
                void syncEngine();
            }
            return { ok: true };
        })());
    }

    /**
     * 写入一个密钥，然后刷新密钥保存状态。
     * @param {{ key: string, value: string, label: string, description?: string, activate?: boolean }} options 密钥名、明文、记录标签、
     *   提示用名称；activate 为 false 时不改变这个密钥名下当前启用的那条（模型服务按 id 读取自己那条）
     * @returns {Promise<{ ok: boolean, id?: string, error?: Error }>} 结果，成功时带新密钥条目的 id
     */
    function commitSecret({ key, value, label, description = '密钥', activate = true }) {
        setStatus('saving', `正在保存${description}…`);
        return track((async () => {
            let id = '';
            try {
                const result = await apiFetch('/api/secrets/write', { body: { key, value, label, ...(activate ? {} : { activate: false }) } });
                id = typeof result?.id === 'string' ? result.id : '';
            } catch (error) {
                setStatus('error', withSuffix(description, '保存失败'), error.message);
                showToast(withSuffix(description, '保存失败'), error.message);
                return { ok: false, error };
            }
            try {
                state.secretState = await apiFetch('/api/secrets/read');
            } catch {
                // 读不到最新状态不影响已经写入的密钥，下次整页刷新会再读
            }
            setStatus('saved', withSuffix(description, '已保存'));
            return { ok: true, id };
        })());
    }

    /**
     * 由别的模块完成保存的改动（例如应用预设、保存翻译设置）：期间显示「保存中」，结束后显示结果。
     * @param {string} label 名称
     * @param {() => Promise<unknown>} task 保存动作，失败时抛出
     * @returns {Promise<{ ok: boolean, error?: Error }>} 结果
     */
    function runTask(label, task) {
        setStatus('saving', `正在保存${label}…`);
        return track((async () => {
            try {
                await task();
            } catch (error) {
                setStatus('error', withSuffix(label, '保存失败'), error.message);
                showToast(withSuffix(label, '保存失败'), error.message);
                return { ok: false, error };
            }
            setStatus('saved', withSuffix(label, '已保存'));
            return { ok: true };
        })());
    }

    /**
     * 只存在浏览器本地的偏好：直接标记为已保存。
     * @param {string} label 名称
     */
    function markSaved(label) {
        setStatus('saved', withSuffix(label, '已保存'));
    }

    /**
     * 字段校验没通过：在状态标签里说明这次没有保存。
     * @param {string} message 原因
     */
    function markInvalid(message) {
        setStatus('error', '有字段未保存', message);
    }

    /**
     * 保存失败（由别的模块完成保存时用）。
     * @param {string} label 名称
     * @param {string} message 原因
     */
    function markFailed(label, message) {
        setStatus('error', withSuffix(label, '保存失败'), message);
    }

    /**
     * 等待所有在途的保存和引擎重载结束（测试连接、应用档案前调用，保证用的是刚改的设置）。
     * @returns {Promise<void>}
     */
    async function flush() {
        while (pending.size) {
            await Promise.allSettled([...pending]);
        }
    }

    return {
        commit,
        commitSecret,
        runTask,
        markSaved,
        markInvalid,
        markFailed,
        flush,
        syncEngine,
        getStatus,
    };
}

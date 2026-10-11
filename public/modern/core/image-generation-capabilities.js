import { IMAGE_GENERATION_API } from './image-generation-config.js';

/**
 * 读 /api/image-generation/capabilities 并按 provider|model|baseUrl 缓存在 state.imageModelSettings.capabilities。
 * 这个接口不发外部请求、不计费；设置中心「图片模型」和聊天输入框的参数标签共用同一份缓存。
 */

/**
 * @param {{ provider: string, model: string, baseUrl?: string }} target 配置。
 * @returns {string}
 */
export function getCapabilityCacheKey({ provider, model, baseUrl = '' }) {
    return `${provider}|${model}|${baseUrl}`;
}

/**
 * @param {any} state 全局状态。
 * @returns {{ capabilities: Map<string, any>, pending: Map<string, Promise<any>> }}
 */
export function ensureImageModelSettingsState(state) {
    const slot = state.imageModelSettings || (state.imageModelSettings = {});
    if (!(slot.capabilities instanceof Map)) {
        slot.capabilities = new Map();
    }
    if (!(slot.pending instanceof Map)) {
        slot.pending = new Map();
    }
    return slot;
}

/**
 * @param {any} state 全局状态。
 * @param {{ provider: string, model: string, baseUrl?: string }} target 配置。
 * @returns {any | null} 缓存的能力结果，没有时为 null。
 */
export function getCachedImageCapabilities(state, target) {
    return ensureImageModelSettingsState(state).capabilities.get(getCapabilityCacheKey(target)) || null;
}

/**
 * 读能力（有缓存直接返回；同一配置的并发请求合并）。失败时抛出 apiFetch 的错误，不写缓存。
 * @param {Function} apiFetch 带 CSRF 的 JSON 请求。
 * @param {any} state 全局状态。
 * @param {{ provider: string, model: string, baseUrl?: string }} target 配置。
 * @param {{ force?: boolean }} [options] force 为真时忽略缓存重新读取。
 * @returns {Promise<any>} 后端返回的 { supported, reason?, parameters, limits, requiresBaseUrl, requiresKey, keySaved }。
 */
export async function loadImageCapabilities(apiFetch, state, target, { force = false } = {}) {
    const slot = ensureImageModelSettingsState(state);
    const key = getCapabilityCacheKey(target);
    if (!force && slot.capabilities.has(key)) {
        return slot.capabilities.get(key);
    }
    if (slot.pending.has(key)) {
        return slot.pending.get(key);
    }
    const request = apiFetch(`${IMAGE_GENERATION_API}/capabilities`, {
        body: { provider: target.provider, model: target.model, ...(target.baseUrl ? { baseUrl: target.baseUrl } : {}) },
    }).then(result => {
        slot.capabilities.set(key, result);
        return result;
    }).finally(() => {
        slot.pending.delete(key);
    });
    slot.pending.set(key, request);
    return request;
}

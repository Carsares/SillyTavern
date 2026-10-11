/**
 * 聊天内生图（WP2）：输入框模式切换、提示词与参数草稿、发起生成、找回结果、写入聊天、取消。
 * 方案见 docs/image-generation/FRONTEND-DESIGN.md 第 4.1、4.3 节；状态在 core/chat-image-state.js。
 * 动作名在所有功能之间唯一（见 shell/feature-slot-actions.js 顶部说明）。
 *
 * 流程：校验配置 → 占用生成锁（state.engine.generating + activity 'image'）→ 记下任务（sessionStorage 也存一份，刷新后找回）
 * → POST /generate（6 分钟后本地中止）→ 202 时每 3 秒查 /requests/:id；超时、断网、5xx 无结构体时也去查，查到 404 判为「结果未知」
 * → 成功后经 chatContextActions.updateModernChatAndSync 写进发起生成的那个聊天（不在缓存里先读取）→ finally 里解锁并重绘。
 *
 * 两个挂在 state.chatImageGeneration 上的钩子（调用方拿不到功能插槽的动作或 apiFetch）：
 *   cancelJob()         「停止」按钮：actions/chat-generation.js 的 stopModernGeneration 在 state.engine.activity === 'image' 时调用它，
 *                       而不是向隐藏引擎发 STOP。
 *   loadCapabilities()  routes/chat-image-events.js 渲染后调用：图片模式下参数标签需要 /capabilities（不计费），没有缓存时读一次。
 */
import { describeReloadFailure } from '../core/bridge-reload.js';
import { ensureChatImageState, getChatImageView, IMAGE_JOB_STORAGE_KEY } from '../core/chat-image-state.js';
import {
    ensureImageModelSettingsState,
    getCachedImageCapabilities,
    getCapabilityCacheKey,
    loadImageCapabilities,
} from '../core/image-generation-capabilities.js';
import {
    buildImageRequestParams,
    getImageConfigReadiness,
    getImageGenerationConfig,
    IMAGE_GENERATION_API,
} from '../core/image-generation-config.js';
import {
    appendImageVersions,
    buildImageMessage,
    describeImageFailure,
    findMessageIndexByIdentity,
    getImageVersion,
    isImageMessage,
    messageIdentity,
    pickRecentPromptSources,
} from '../core/image-message.js';
import { stripJsonlExtension } from '../core/utils.js';
import { isPromptGenerationSupported } from './chat-image-prompt.js';

/** @typedef {import('../core/chat-image-state.js').ImageJob} ImageJob */
/** @typedef {import('../core/chat-image-state.js').ChatImageView} ChatImageView */
/** @typedef {{ code: string, message: string, detail: string, outcome: string }} JobFailure */
/**
 * @typedef {{ kind: 'completed', result: any } | { kind: 'pending' } | { kind: 'cancelled' }
 *   | { kind: 'failed', failure: JobFailure } | { kind: 'unknown', failure: JobFailure }} JobOutcome
 */

/**
 * @typedef {object} ChatImageGenerationOptions 测试用替身；不传时用浏览器实现。
 * @property {number} [timeoutMs] 生成请求的本地超时（默认 6 分钟，比后端的 5 分钟长）。
 * @property {number} [pollMs] 查询结果的间隔（默认 3 秒）。
 * @property {number} [pollRequestTimeoutMs] 单次查询的超时（默认 30 秒）。
 * @property {(ms: number, signal?: AbortSignal) => Promise<void>} [sleep] 可中止的等待。
 * @property {() => number} [now] 当前毫秒数。
 * @property {() => string} [randomUUID] requestId 生成器。
 * @property {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void } | null} [storage]
 *   记进行中任务的存储（默认 sessionStorage）。
 */

export const IMAGE_GENERATE_TIMEOUT_MS = 6 * 60 * 1000;
export const IMAGE_POLL_INTERVAL_MS = 3000;
const POLL_REQUEST_TIMEOUT_MS = 30 * 1000;
const IMAGE_BUSY_DETAIL = '图片生成中…';
const REQUEST_PARAM_KEYS = ['width', 'height', 'aspectRatio', 'imageSize', 'quality', 'style', 'count', 'negativePrompt', 'seed', 'steps', 'outputFormat'];
const CANCELLED = /** @type {JobOutcome} */ ({ kind: 'cancelled' });

// 后端错误码的中文说明（后端 message 是固定英文，见 src/endpoints/image-generation.js）；供应商给的原因放在 detail 里
const FAILURE_TEXT = Object.freeze({
    'invalid-request': '请求参数不被接受，没有发给供应商。',
    'unsupported-provider': '当前图片供应商暂不支持。',
    'secret-missing': '没有读到图片模型的 API Key，请先到设置中心保存。',
    'image-generation-busy': '已有一张图片在生成中（可能在别的标签页），请等它结束再试。',
    'provider-http-error': '图片供应商返回了错误。',
    'provider-response-invalid': '图片供应商返回的内容无法使用。',
    'provider-network-error': '连接图片供应商失败。',
    'provider-timeout': '图片供应商超过 5 分钟没有返回。',
    'image-download-failed': '图片已生成，但从供应商下载失败。',
    'save-failed': '图片已生成，但保存到本地失败。',
    'internal-error': '服务端准备请求时出错，没有发给供应商。',
    'request-not-found': '服务端没有这次生成的记录。',
    cancelled: '这次生成已停止。',
});

/**
 * 聊天输入框图片模式自己的界面状态（模型标签弹层、待聚焦、能力读取失败），挂在 state.chatImageGeneration.composer。
 * @param {any} state 全局状态。
 * @returns {{ modelChipOpen: boolean, focusPrompt: boolean, capabilityError: { key: string, message: string } | null }}
 */
export function getChatImageComposerState(state) {
    const slot = /** @type {any} */ (ensureChatImageState(state));
    if (!slot.composer || typeof slot.composer !== 'object') {
        slot.composer = { modelChipOpen: false, focusPrompt: false, capabilityError: null };
    }
    return slot.composer;
}

/**
 * apiFetch 失败转成任务失败信息，错误码换成中文说明。
 * @param {ReturnType<typeof describeImageFailure>} described describeImageFailure 的结果。
 * @returns {JobFailure}
 */
function toJobFailure(described) {
    return {
        code: described.code,
        message: FAILURE_TEXT[described.code] || described.message,
        detail: described.detail || '',
        outcome: described.outcome,
    };
}

/**
 * @param {string} reason 为什么判为结果未知。
 * @returns {JobFailure}
 */
function unknownFailure(reason) {
    return { code: 'result-unknown', message: reason, detail: '', outcome: 'unknown' };
}

/**
 * @param {any} error 任意错误。
 * @returns {string} 给人看的一句话。
 */
export function describeImageRequestError(error) {
    const described = describeImageFailure(error);
    if (!described.uncertain) {
        return FAILURE_TEXT[described.code] || described.message;
    }
    return error?.message || described.message;
}

/**
 * 从已发送过的请求参数里挑出当前供应商支持的（重新生成、重试时用）。
 * @param {Record<string, any>} params 之前的请求参数。
 * @param {string[]} parameters /capabilities 的 parameters。
 * @returns {Record<string, any>}
 */
export function pickImageRequestParams(params, parameters) {
    const allowed = new Set(Array.isArray(parameters) ? parameters : []);
    /** @type {Record<string, any>} */
    const result = {};
    for (const key of REQUEST_PARAM_KEYS) {
        const value = params?.[key];
        if (!allowed.has(key) || value === null || value === undefined || value === '') {
            continue;
        }
        result[key] = value;
    }
    if (!('width' in result) || !('height' in result)) {
        delete result.width;
        delete result.height;
    }
    return result;
}

/**
 * 已发送的请求参数换回输入框草稿的参数（width + height → size，其余同名），用于「编辑提示词」时连参数一起放回。
 * @param {Record<string, any>} params 请求参数。
 * @returns {Record<string, any>}
 */
export function draftFromRequestParams(params) {
    /** @type {Record<string, any>} */
    const draft = {};
    if (Number(params?.width) > 0 && Number(params?.height) > 0) {
        draft.size = `${Number(params.width)}x${Number(params.height)}`;
    }
    for (const key of ['aspectRatio', 'quality', 'style', 'count', 'negativePrompt', 'seed', 'steps']) {
        const value = params?.[key];
        if (value !== null && value !== undefined && value !== '') {
            draft[key] = value;
        }
    }
    return draft;
}

/**
 * 数量不超过供应商上限、不少于 1。返回新对象。
 * @param {Record<string, any>} params 请求参数。
 * @param {{ countMax?: number } | undefined} limits /capabilities 的 limits。
 * @returns {Record<string, any>}
 */
export function clampImageCount(params, limits) {
    if (!('count' in params)) {
        return params;
    }
    const max = Number.isSafeInteger(limits?.countMax) && limits.countMax >= 1 ? limits.countMax : 1;
    const count = Number(params.count);
    return { ...params, count: Math.min(Math.max(Number.isSafeInteger(count) ? count : 1, 1), max) };
}

/**
 * 生成中卡片的高宽比：有宽高按宽高，有比例按比例，都没有按方图。
 * @param {Record<string, any>} params 请求参数。
 * @returns {number}
 */
export function getImageRatio(params) {
    if (Number(params?.width) > 0 && Number(params?.height) > 0) {
        return Number(params.height) / Number(params.width);
    }
    const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(params?.aspectRatio || ''));
    if (match && Number(match[1]) > 0 && Number(match[2]) > 0) {
        return Number(match[2]) / Number(match[1]);
    }
    return 1;
}

/**
 * 新图片消息的 send_date：ISO 时间，与已有消息重复时往后挪 1 毫秒（send_date 是消息身份的一部分）。
 * @param {any[]} messages 聊天消息。
 * @param {number} nowMs 当前毫秒数。
 * @returns {string}
 */
export function createUniqueSendDate(messages, nowMs) {
    const used = new Set((Array.isArray(messages) ? messages : []).map(message => String(message?.send_date ?? '')));
    let time = nowMs;
    let iso = new Date(time).toISOString();
    while (used.has(iso)) {
        time += 1;
        iso = new Date(time).toISOString();
    }
    return iso;
}

/**
 * 可中止的等待。
 * @param {number} ms 毫秒。
 * @param {AbortSignal} [signal] 中止信号。
 * @returns {Promise<void>}
 */
function defaultSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * 跑一个带超时的请求：外层信号中止或超过 ms 都会中止它。
 * @template T
 * @param {AbortSignal} parent 外层信号（用户停止）。
 * @param {number} ms 超时毫秒。
 * @param {(signal: AbortSignal) => Promise<T>} task 请求。
 * @returns {Promise<T>}
 */
async function withDeadline(parent, ms, task) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (parent.aborted) {
        controller.abort();
    } else {
        parent.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(abort, Math.max(0, ms));
    try {
        return await task(controller.signal);
    } finally {
        clearTimeout(timer);
        parent.removeEventListener('abort', abort);
    }
}

/**
 * /generate、/requests/:id、/cancel 的成功响应转成任务结局；读不懂时为 null。
 * @param {any} reply 响应体。
 * @returns {JobOutcome | null}
 */
export function readImageRecord(reply) {
    if (!reply || typeof reply !== 'object') {
        return null;
    }
    switch (reply.status) {
        case 'completed':
            return Array.isArray(reply.images) && reply.images.some(image => typeof image?.path === 'string' && image.path)
                ? { kind: 'completed', result: reply }
                : { kind: 'failed', failure: { code: 'provider-response-invalid', message: '服务端说已完成，但没有返回图片。', detail: '', outcome: 'unknown' } };
        case 'pending':
            return { kind: 'pending' };
        case 'cancelled':
            return CANCELLED;
        case 'failed': {
            const described = describeImageFailure({ status: null, body: JSON.stringify(reply.error || {}) });
            return described.uncertain
                ? { kind: 'unknown', failure: unknownFailure('服务端记录这次生成失败，但没有说明原因。') }
                : { kind: 'failed', failure: toJobFailure(described) };
        }
        default:
            return null;
    }
}

/**
 * @param {import('../shell/feature-slot-actions.js').FeatureSlotDeps & { chatImageGenerationOptions?: ChatImageGenerationOptions }} deps 依赖。
 * @returns {Record<string, Function>}
 */
export function createChatImageGenerationActions(deps) {
    const { state, apiFetch, render, showToast, actionRegistry } = deps;
    const options = deps.chatImageGenerationOptions || {};
    const timeoutMs = options.timeoutMs ?? IMAGE_GENERATE_TIMEOUT_MS;
    const pollMs = options.pollMs ?? IMAGE_POLL_INTERVAL_MS;
    const pollRequestTimeoutMs = options.pollRequestTimeoutMs ?? POLL_REQUEST_TIMEOUT_MS;
    const sleep = options.sleep || defaultSleep;
    const now = options.now || (() => Date.now());
    const randomUUID = options.randomUUID || (() => globalThis.crypto.randomUUID());
    const slot = ensureChatImageState(state);

    /** @type {{ requestId: string, controller: AbortController, cancelRequest: Promise<any> | null, finished: Promise<void> | null, outcome: string } | null} */
    let activeRun = null;
    /** @type {{ status: string, detail: string } | null} */
    let lockSnapshot = null;
    let starting = false;
    let recoveryDone = false;

    // 钩子，见文件顶部说明
    /** @type {any} */ (state.chatImageGeneration).cancelJob = () => cancelChatImageJob();
    /** @type {any} */ (state.chatImageGeneration).loadCapabilities = () => loadComposerCapabilities();

    /**
     * 输入框参数标签用的能力：配置齐全、没有缓存、没有在读、上次读同一配置没有失败时读一次，读完重绘。失败记下原因，
     * 点「重试」（清掉 capabilityError）才再读，不在每次渲染时反复请求。
     * @returns {Promise<boolean>} 是否发起了读取。
     */
    async function loadComposerCapabilities() {
        const config = getImageGenerationConfig(state.settings);
        if (!getImageConfigReadiness(config, state.secretState).ok || getCachedImageCapabilities(state, config)) {
            return false;
        }
        const key = getCapabilityCacheKey(config);
        const composer = getChatImageComposerState(state);
        if (composer.capabilityError?.key === key || ensureImageModelSettingsState(state).pending.has(key)) {
            return false;
        }
        try {
            await loadImageCapabilities(apiFetch, state, config);
        } catch (error) {
            composer.capabilityError = { key, message: describeImageRequestError(error) };
        }
        render();
        return true;
    }

    function chat() {
        return actionRegistry?.chatContextActions || {};
    }

    function getStorage() {
        if (options.storage !== undefined) {
            return options.storage;
        }
        try {
            return globalThis.sessionStorage || null;
        } catch {
            return null;
        }
    }

    function readStoredJob() {
        try {
            const raw = getStorage()?.getItem(IMAGE_JOB_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    /** @param {ImageJob} job 任务。 */
    function storeJob(job) {
        const { requestId, cacheKey, contextKey, chatId, groupMode, kind, targetIdentity, prompt, negativePrompt, params, provider, model, origin, sourceCount, startedAt, ratio } = job;
        try {
            getStorage()?.setItem(IMAGE_JOB_STORAGE_KEY, JSON.stringify({ requestId, cacheKey, contextKey, chatId, groupMode, kind, targetIdentity, prompt, negativePrompt, params, provider, model, origin, sourceCount, startedAt, ratio }));
        } catch {
            // 存储不可用（隐私模式、配额满）只影响刷新后找回，不影响这次生成
        }
    }

    /** @param {string} requestId 只清掉这一单的记录。 */
    function clearStoredJob(requestId) {
        const stored = readStoredJob();
        if (stored && stored.requestId && stored.requestId !== requestId) {
            return;
        }
        try {
            getStorage()?.removeItem(IMAGE_JOB_STORAGE_KEY);
        } catch {
            // 同上
        }
    }

    /**
     * 当前选中的聊天；没有选中角色 / 群聊或聊天文件时为 null。
     * @returns {{ entity: any, chatId: string, groupMode: boolean, contextKey: string, cacheKey: string } | null}
     */
    function getCurrentTarget() {
        const context = chat();
        const entity = context.getSelectedChatEntity?.();
        const rawChatId = state.selected?.chat || '';
        if (!entity || !rawChatId) {
            return null;
        }
        const groupMode = Boolean(context.isGroupChatMode?.());
        const contextKey = context.getChatContextKey?.(entity, groupMode) || '';
        if (!contextKey || contextKey === 'group:') {
            return null;
        }
        return { entity, chatId: stripJsonlExtension(rawChatId), groupMode, contextKey, cacheKey: context.getCurrentDraftKey?.() || `${contextKey}::${rawChatId}` };
    }

    function getCurrentView() {
        const target = getCurrentTarget();
        return target ? getChatImageView(state, target.cacheKey) : null;
    }

    function getCurrentMessages() {
        const messages = chat().getSelectedChatMessages?.();
        return Array.isArray(messages) ? messages : [];
    }

    /**
     * @param {string} contextKey 角色 avatar 或 group:<id>。
     * @param {boolean} groupMode 是否群聊。
     * @returns {any} 角色或群聊；已不存在时为 null。
     */
    function resolveEntity(contextKey, groupMode) {
        if (groupMode) {
            return (state.groups || []).find(group => `group:${group.id}` === contextKey) || null;
        }
        return (state.characters || []).find(character => character.avatar === contextKey) || null;
    }

    /**
     * 单聊用角色名，群聊用群名：既是图片消息的署名，也是后端存图的子目录名。
     * @param {any} entity 角色或群聊。
     * @param {boolean} groupMode 是否群聊。
     * @returns {string}
     */
    function getEntityName(entity, groupMode) {
        if (groupMode) {
            return entity?.name || '未命名群聊';
        }
        return entity?.name || entity?.data?.name || '未命名角色';
    }

    /** @param {string} detail 状态行文字。 */
    function lock(detail) {
        if (!lockSnapshot) {
            lockSnapshot = { status: state.engine.status, detail: state.engine.detail };
        }
        state.engine.generating = true;
        state.engine.activity = 'image';
        state.engine.status = '生成中';
        state.engine.detail = detail;
    }

    function unlock() {
        if (state.engine.activity === 'image') {
            state.engine.generating = false;
            state.engine.activity = '';
        }
        if (lockSnapshot) {
            state.engine.status = lockSnapshot.status;
            state.engine.detail = lockSnapshot.detail;
            lockSnapshot = null;
        }
    }

    function getBusyReason() {
        if (state.engine.activity === 'image' || starting) {
            return '已有一张图片在生成中，等它结束或停止等待后再试。';
        }
        return '文本回复生成中，结束后才能生成图片。';
    }

    /**
     * 一直查 /requests/:id，直到有结论、用户停止或超过截止时间。至少查一次。
     * @param {ImageJob} job 任务。
     * @param {AbortSignal} signal 用户停止。
     * @param {number} deadline 截止时间（毫秒）。
     * @returns {Promise<JobOutcome>}
     */
    async function pollOutcome(job, signal, deadline) {
        const path = `${IMAGE_GENERATION_API}/requests/${encodeURIComponent(job.requestId)}`;
        for (;;) {
            if (signal.aborted) {
                return CANCELLED;
            }
            try {
                const reply = await withDeadline(signal, pollRequestTimeoutMs, requestSignal => apiFetch(path, { method: 'GET', signal: requestSignal }));
                const outcome = readImageRecord(reply);
                if (outcome && outcome.kind !== 'pending') {
                    return outcome;
                }
            } catch (error) {
                if (signal.aborted) {
                    return CANCELLED;
                }
                const described = describeImageFailure(error);
                if (described.status === 404) {
                    return { kind: 'unknown', failure: unknownFailure('服务端已经没有这次生成的记录（服务重启过，或已超过 30 分钟），拿不到结果。') };
                }
                if (!described.uncertain && described.status && described.status < 500) {
                    return { kind: 'unknown', failure: unknownFailure(`查询生成结果被拒绝：${FAILURE_TEXT[described.code] || described.message}`) };
                }
                // 其余（断网、5xx）当作暂时失败，到截止时间前继续查
            }
            if (now() >= deadline) {
                return { kind: 'unknown', failure: unknownFailure('等待超过 6 分钟仍没有拿到结果。') };
            }
            try {
                await sleep(pollMs, signal);
            } catch {
                return CANCELLED;
            }
        }
    }

    /**
     * 提交（可选）并等到结论。
     * @param {ImageJob} job 任务。
     * @param {AbortSignal} signal 用户停止。
     * @param {{ body?: Record<string, any>, deadline: number }} input body 为空时只查结果（找回）。
     * @returns {Promise<JobOutcome>}
     */
    async function waitForOutcome(job, signal, { body, deadline }) {
        if (body) {
            try {
                const reply = await withDeadline(signal, deadline - now(), requestSignal => apiFetch(`${IMAGE_GENERATION_API}/generate`, { body, signal: requestSignal }));
                const outcome = readImageRecord(reply);
                if (outcome && outcome.kind !== 'pending') {
                    return outcome;
                }
                // 202（同一 requestId 还在进行）或读不懂的响应：去查结果
            } catch (error) {
                if (signal.aborted) {
                    return CANCELLED;
                }
                const described = describeImageFailure(error);
                if (described.code === 'cancelled') {
                    return CANCELLED;
                }
                if (!described.uncertain) {
                    return { kind: 'failed', failure: toJobFailure(described) };
                }
                // 本地超时、断网、5xx 无结构体：没拿到后端结论，去查，不重新提交（后端在浏览器断开后会继续生成）
            }
        }
        return pollOutcome(job, signal, deadline);
    }

    /**
     * 把生成的图片写进发起生成的聊天（不一定是当前聊天）。
     * @param {ImageJob} job 任务。
     * @param {any} result 后端的完成结果 { images, provider?, model?, elapsedMs?, incomplete? }。
     * @returns {Promise<{ ok: true, fallback: boolean, reload: any, incomplete: number } | { ok: false, error: any, paths: string[] }>}
     */
    async function writeResult(job, result) {
        const images = (result.images || []).filter(image => typeof image?.path === 'string' && image.path);
        const paths = images.map(image => image.path);
        try {
            const context = chat();
            const entity = resolveEntity(job.contextKey, job.groupMode);
            if (!entity) {
                throw new Error('发起生成的角色或群聊已不存在。');
            }
            const cacheKey = context.getChatCacheKey ? context.getChatCacheKey(job.contextKey, job.chatId) : job.cacheKey;
            if (!state.chatMessages?.[cacheKey]) {
                // 生成期间切走了，原聊天不在缓存里：先读取（updateModernChatAndSync 不允许在没读过的聊天上保存）
                await context.loadChatMessages(entity, job.chatId, { force: true, groupMode: job.groupMode, isContextCurrent: () => false });
                if (!state.chatMessages?.[cacheKey]) {
                    throw new Error('聊天记录读取失败。');
                }
            }
            const meta = {
                prompt: job.prompt,
                negativePrompt: job.negativePrompt || '',
                provider: result.provider || job.provider,
                model: result.model || job.model,
                params: job.params,
                requestId: job.requestId,
                origin: job.origin,
                sourceCount: job.sourceCount,
                elapsedMs: Number.isFinite(result.elapsedMs) ? result.elapsedMs : Math.max(0, now() - job.startedAt),
            };
            const name = getEntityName(entity, job.groupMode);
            const { result: written, engineSync } = await context.updateModernChatAndSync(entity, job.chatId, messages => {
                if (job.kind === 'version') {
                    const index = findMessageIndexByIdentity(messages, job.targetIdentity);
                    if (index >= 0 && isImageMessage(messages[index])) {
                        messages[index] = appendImageVersions(messages[index], images, meta);
                        return { fallback: false };
                    }
                }
                // 新消息；要加版本的那条已被删掉时也作为新消息插入，已经付费的图不丢
                messages.push(buildImageMessage({ name, sendDate: createUniqueSendDate(messages, now()), images, meta }));
                return { fallback: job.kind === 'version' };
            }, { groupMode: job.groupMode });
            try {
                await context.refreshSelectedChatList?.(entity, { groupMode: job.groupMode, quiet: true });
            } catch {
                // 列表刷新失败不影响已经写好的聊天文件
            }
            const reload = await engineSync;
            return { ok: true, fallback: Boolean(written?.fallback), reload, incomplete: Number(result.incomplete) || 0 };
        } catch (error) {
            return { ok: false, error, paths };
        }
    }

    /**
     * 按结局更新任务：成功写入后清掉任务；失败和结果未知留给消息列表里的卡片（components/chat-image-message.js）。
     * @param {ImageJob} job 任务。
     * @param {JobOutcome} outcome 结局。
     * @param {{ userCancelled: boolean }} info 是不是用户自己点的停止。
     * @returns {Promise<string>} 实际的结局类型。
     */
    async function settleJob(job, outcome, { userCancelled }) {
        if (outcome.kind === 'completed') {
            state.engine.detail = '正在把图片写入聊天…';
            const written = await writeResult(job, outcome.result);
            if (written.ok === true) {
                if (slot.job === job) {
                    slot.job = null;
                }
                const notes = [
                    written.fallback ? '原图片消息已不存在，新图作为一条新消息插入。' : '',
                    written.incomplete ? `有 ${written.incomplete} 张没能保存。` : '',
                    describeReloadFailure(written.reload),
                ].filter(Boolean).join('');
                showToast(job.kind === 'version' && !written.fallback ? '已生成新版本' : '图片已插入会话', notes || '图片消息不进入后续文本上下文。');
                return 'completed';
            }
            const where = written.paths.length ? written.paths.join('、') : '图片目录（/user/images/）';
            job.status = 'failed';
            job.failure = {
                code: 'write-failed',
                message: `图片已生成并保存在 ${where}，但没能写入会话：${written.error?.message || '未知原因'}`,
                detail: written.paths.join('\n'),
                outcome: 'charged',
            };
            showToast('图片没能写入会话', job.failure.message);
            return 'failed';
        }
        if (outcome.kind === 'cancelled') {
            if (slot.job === job) {
                slot.job = null;
            }
            if (!userCancelled) {
                showToast('图片生成已停止', '这次生成在别处被停止了；若供应商已开始生成，可能仍会计费。');
            }
            return 'cancelled';
        }
        if (outcome.kind === 'failed' || outcome.kind === 'unknown') {
            job.status = outcome.kind;
            job.failure = outcome.failure;
            showToast(outcome.kind === 'failed' ? '图片生成失败' : '图片结果未知', outcome.failure.message);
            return outcome.kind;
        }
        job.status = 'unknown';
        job.failure = unknownFailure('没有拿到图片生成的结果。');
        return 'unknown';
    }

    /**
     * 跑一单：登记任务、加锁、等结论、写入，finally 解锁并重绘。返回的 Promise 在整单结束后 resolve，永不 reject。
     * @param {ImageJob} job 任务（status 为 pending）。
     * @param {{ body?: Record<string, any>, deadline: number }} input body 为空时只查结果（找回）。
     */
    function startRun(job, input) {
        const run = { requestId: job.requestId, controller: new AbortController(), cancelRequest: null, finished: null, outcome: '' };
        activeRun = run;
        slot.job = job;
        storeJob(job);
        lock(IMAGE_BUSY_DETAIL);
        render();
        run.finished = (async () => {
            try {
                let outcome = await waitForOutcome(job, run.controller.signal, input);
                if (outcome.kind === 'cancelled' && run.cancelRequest) {
                    // 停止和完成撞在一起时，/cancel 会原样返回完成结果：图已经付费，照常写入
                    const reply = await run.cancelRequest;
                    const late = readImageRecord(reply);
                    if (late?.kind === 'completed') {
                        outcome = late;
                    }
                }
                run.outcome = await settleJob(job, outcome, { userCancelled: Boolean(run.cancelRequest) });
            } catch (error) {
                job.status = 'unknown';
                job.failure = unknownFailure(`处理生成结果时出错：${error?.message || error}`);
                run.outcome = 'unknown';
            } finally {
                if (activeRun === run) {
                    activeRun = null;
                }
                clearStoredJob(job.requestId);
                unlock();
                render();
            }
        })();
        return run.finished;
    }

    /**
     * 校验、读能力、组请求并开跑。
     * @param {object} input 输入。
     * @param {{ entity: any, chatId: string, groupMode: boolean, contextKey: string, cacheKey: string }} input.target 写入哪个聊天。
     * @param {'new'|'version'} input.kind 新消息 / 加版本。
     * @param {string} input.targetIdentity kind 为 version 时的目标消息身份。
     * @param {string} input.prompt 提示词。
     * @param {(parameters: string[]) => Record<string, any>} input.buildParams 按供应商支持的参数组请求字段。
     * @param {'manual'|'messages'} input.origin 提示词来源。
     * @param {number} input.sourceCount 从几条消息生成。
     * @returns {Promise<boolean>} 是否真的发起了生成（整单结束后才 resolve）。
     */
    async function submitJob({ target, kind, targetIdentity, prompt, buildParams, origin, sourceCount }) {
        if (starting || state.engine.generating) {
            showToast('现在不能生成图片', getBusyReason());
            return false;
        }
        const config = getImageGenerationConfig(state.settings);
        const readiness = getImageConfigReadiness(config, state.secretState);
        if (!readiness.ok) {
            showToast('还没有配置好图片模型', readiness.reason);
            return false;
        }
        starting = true;
        lock('正在读取图片模型的可用参数…');
        render();
        let capabilities;
        try {
            capabilities = await loadImageCapabilities(apiFetch, state, { provider: config.provider, model: config.model, baseUrl: config.baseUrl });
        } catch (error) {
            unlock();
            render();
            showToast('读取图片模型参数失败', describeImageRequestError(error));
            return false;
        } finally {
            starting = false;
        }
        if (!capabilities?.supported) {
            unlock();
            render();
            showToast('当前图片模型不可用', capabilities?.reason || '供应商不支持这个模型。');
            return false;
        }
        const params = clampImageCount(buildParams(capabilities.parameters || []), capabilities.limits);
        const requestId = randomUUID();
        /** @type {ImageJob} */
        const job = {
            requestId,
            status: 'pending',
            cacheKey: target.cacheKey,
            contextKey: target.contextKey,
            chatId: target.chatId,
            groupMode: target.groupMode,
            kind,
            targetIdentity: targetIdentity || '',
            prompt,
            negativePrompt: typeof params.negativePrompt === 'string' ? params.negativePrompt : '',
            params,
            provider: config.provider,
            model: config.model,
            origin,
            sourceCount: Number(sourceCount) || 0,
            startedAt: now(),
            ratio: getImageRatio(params),
            failure: null,
        };
        const body = {
            requestId,
            provider: config.provider,
            model: config.model,
            ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
            ...(config.secretId ? { secretId: config.secretId } : {}),
            characterName: getEntityName(target.entity, target.groupMode),
            prompt,
            ...params,
        };
        await startRun(job, { body, deadline: job.startedAt + timeoutMs });
        return true;
    }

    function isImageModelReady() {
        return getImageConfigReadiness(getImageGenerationConfig(state.settings), state.secretState).ok;
    }

    /** @param {ChatImageView} view 当前聊天的图片界面状态。 */
    function initializeSelection(view) {
        if (view.selectionInitialized) {
            return;
        }
        const config = getImageGenerationConfig(state.settings);
        view.selected = pickRecentPromptSources(getCurrentMessages(), config.promptGen.defaultSelectCount);
        view.includeAppearance = config.promptGen.includeAppearance;
        view.selectionInitialized = true;
        view.autoStep = 1;
    }

    /**
     * 输入框「文本 / 图片」切换。生成中不可切换。
     * @param {'text'|'image'} mode 模式。
     * @returns {boolean} 是否切换了。
     */
    function setChatImageMode(mode) {
        const view = getCurrentView();
        if (!view || state.engine.generating) {
            return false;
        }
        view.mode = mode === 'image' ? 'image' : 'text';
        const composer = getChatImageComposerState(state);
        composer.modelChipOpen = false;
        if (view.mode === 'image') {
            // 没配置好图片模型时不留在「从消息生成」：输入框只显示空状态，消息列表也不该出现勾选框
            if (view.sub === 'auto' && !isImageModelReady()) {
                view.sub = 'manual';
            }
            if (view.sub === 'auto') {
                initializeSelection(view);
            }
            composer.focusPrompt = true;
        }
        render();
        return true;
    }

    /**
     * 图片模式下的「手动输入 / 从消息生成」。主连接不是聊天补全时不能切到从消息生成。
     * @param {'manual'|'auto'} sub 子模式。
     * @returns {boolean} 是否切换了。
     */
    function setChatImageSubMode(sub) {
        const view = getCurrentView();
        if (!view || state.engine.generating) {
            return false;
        }
        const next = sub === 'auto' ? 'auto' : 'manual';
        if (next === 'auto' && !isPromptGenerationSupported(state.settings)) {
            showToast('不能从消息生成', '当前主连接是文本补全，第一期只支持聊天补全连接。可以用「手动输入」自己写。');
            return false;
        }
        if (next === 'auto' && !isImageModelReady()) {
            showToast('还没有配置好图片模型', getImageConfigReadiness(getImageGenerationConfig(state.settings), state.secretState).reason);
            return false;
        }
        view.sub = next;
        if (next === 'auto') {
            initializeSelection(view);
        } else {
            getChatImageComposerState(state).focusPrompt = true;
        }
        render();
        return true;
    }

    /**
     * 改提示词 / 参数草稿。逐字输入不重绘，只有展开收起「高级」这种改结构的才重绘。
     * @param {{ prompt?: string, params?: Record<string, any>, showAdvanced?: boolean }} patch 修改。
     * @returns {ChatImageView | null}
     */
    function updateChatImageDraft(patch = {}) {
        const view = getCurrentView();
        if (!view) {
            return null;
        }
        if (typeof patch.prompt === 'string') {
            view.prompt = patch.prompt;
        }
        if (patch.params && typeof patch.params === 'object') {
            const params = { ...view.params };
            for (const [key, value] of Object.entries(patch.params)) {
                if (value === undefined) {
                    delete params[key];
                } else {
                    params[key] = value;
                }
            }
            view.params = params;
        }
        if (typeof patch.showAdvanced === 'boolean' && patch.showAdvanced !== view.showAdvanced) {
            view.showAdvanced = patch.showAdvanced;
            render();
        }
        return view;
    }

    function clearChatImageDraft() {
        const view = getCurrentView();
        if (!view) {
            return false;
        }
        view.prompt = '';
        getChatImageComposerState(state).focusPrompt = true;
        render();
        return true;
    }

    /** 用当前聊天的提示词和参数生成一条新的图片消息。 */
    async function generateChatImage() {
        const target = getCurrentTarget();
        if (!target) {
            showToast('不能生成图片', '先选择角色或群聊的聊天文件。');
            return false;
        }
        const view = getChatImageView(state, target.cacheKey);
        const prompt = view.prompt.trim();
        if (!prompt) {
            showToast('不能生成图片', '先写提示词。');
            return false;
        }
        const config = getImageGenerationConfig(state.settings);
        const values = { ...config.defaults, ...view.params };
        const fromMessages = view.sub === 'auto' && view.promptFrom > 0;
        return submitJob({
            target,
            kind: 'new',
            targetIdentity: '',
            prompt,
            buildParams: parameters => buildImageRequestParams(values, parameters),
            origin: fromMessages ? 'messages' : 'manual',
            sourceCount: fromMessages ? view.promptFrom : 0,
        });
    }

    /**
     * @param {any} messageIndex 消息下标（数字或数字字符串）。
     * @returns {any} 当前聊天里的这条消息；下标无效时为 null。
     */
    function getMessageAt(messageIndex) {
        if (messageIndex === null || messageIndex === undefined || messageIndex === '') {
            return null;
        }
        const index = Number(messageIndex);
        return Number.isSafeInteger(index) && index >= 0 ? getCurrentMessages()[index] || null : null;
    }

    /**
     * 给已有图片消息生成新版本：沿用当前版本的提示词和参数（按当前供应商支持的参数过滤）。
     * @param {number} messageIndex 图片消息下标。
     */
    async function regenerateChatImage(messageIndex) {
        const target = getCurrentTarget();
        const message = getMessageAt(messageIndex);
        if (!target || !isImageMessage(message)) {
            showToast('不能重新生成', '找不到这条图片消息。');
            return false;
        }
        const { item } = getImageVersion(message);
        const prompt = String(item?.title || '').trim();
        if (!prompt) {
            showToast('不能重新生成', '这张图没有记录提示词，请用「编辑提示词」重新写。');
            return false;
        }
        const previous = { ...(item.generation?.params || {}) };
        if (item.negative) {
            previous.negativePrompt = item.negative;
        }
        const fromMessages = item.generation?.origin === 'messages';
        return submitJob({
            target,
            kind: 'version',
            targetIdentity: messageIdentity(message),
            prompt,
            buildParams: parameters => pickImageRequestParams(previous, parameters),
            origin: fromMessages ? 'messages' : 'manual',
            sourceCount: fromMessages ? Number(item.generation?.sourceCount) || 0 : 0,
        });
    }

    /**
     * 把提示词放回输入框（图片 / 手动输入）。传图片消息下标时取它当前版本的提示词；不传时取当前聊天里失败或结果未知的任务，
     * 并移除那张卡片（任务卡片上的「编辑提示词」）。
     * @param {number} [messageIndex] 图片消息下标。
     * @returns {boolean} 是否填入了提示词。
     */
    function editChatImagePrompt(messageIndex) {
        const target = getCurrentTarget();
        if (!target) {
            return false;
        }
        const view = getChatImageView(state, target.cacheKey);
        const message = getMessageAt(messageIndex);
        let prompt = '';
        /** @type {Record<string, any>} */
        let params = {};
        if (isImageMessage(message)) {
            const { item } = getImageVersion(message);
            prompt = String(item?.title || '');
            params = { ...(item?.generation?.params || {}), ...(item?.negative ? { negativePrompt: item.negative } : {}) };
        } else if (slot.job && slot.job.status !== 'pending' && slot.job.cacheKey === target.cacheKey) {
            prompt = slot.job.prompt;
            params = { ...(slot.job.params || {}), ...(slot.job.negativePrompt ? { negativePrompt: slot.job.negativePrompt } : {}) };
            slot.job = null;
        } else {
            return false;
        }
        view.mode = 'image';
        view.sub = 'manual';
        view.prompt = prompt;
        view.promptFrom = 0;
        view.params = { ...view.params, ...draftFromRequestParams(params) };
        if (view.params.negativePrompt) {
            view.showAdvanced = true;
        }
        slot.lightbox = null;
        const composer = getChatImageComposerState(state);
        composer.modelChipOpen = false;
        composer.focusPrompt = true;
        render();
        return true;
    }

    /**
     * 停止等待：先请后端取消（中止供应商请求），再中止本地等待。供应商可能已经开始生成并计费。
     * @returns {Promise<boolean>} 是否停止了一单。
     */
    async function cancelChatImageJob() {
        const job = slot.job;
        const run = activeRun;
        if (!job || job.status !== 'pending' || !run || run.requestId !== job.requestId) {
            return false;
        }
        if (run.cancelRequest) {
            await run.finished;
            return true;
        }
        state.engine.detail = '正在停止等待…';
        render();
        run.cancelRequest = Promise.resolve()
            .then(() => apiFetch(`${IMAGE_GENERATION_API}/cancel`, { body: { requestId: job.requestId } }))
            .catch(() => null);
        await run.cancelRequest;
        run.controller.abort();
        await run.finished;
        if (run.outcome === 'cancelled') {
            showToast('已停止等待', '若供应商已开始生成，可能仍会计费');
        }
        return true;
    }

    /** 失败或结果未知的任务用同样的提示词和参数重新提交（新的 requestId，会再次计费）。 */
    async function retryChatImageJob() {
        const job = slot.job;
        if (!job || job.status === 'pending') {
            return false;
        }
        if (starting || state.engine.generating) {
            showToast('现在不能重新提交', getBusyReason());
            return false;
        }
        const entity = resolveEntity(job.contextKey, job.groupMode);
        if (!entity) {
            showToast('不能重新提交', '发起生成的角色或群聊已不存在。');
            return false;
        }
        const previous = { ...job.params };
        const submitted = submitJob({
            target: { entity, chatId: job.chatId, groupMode: job.groupMode, contextKey: job.contextKey, cacheKey: job.cacheKey },
            kind: job.kind,
            targetIdentity: job.targetIdentity,
            prompt: job.prompt,
            buildParams: parameters => pickImageRequestParams(previous, parameters),
            origin: job.origin,
            sourceCount: job.sourceCount,
        });
        return submitted;
    }

    function dismissChatImageJob() {
        if (!slot.job || slot.job.status === 'pending') {
            return false;
        }
        slot.job = null;
        render();
        return true;
    }

    /**
     * 刷新页面后找回进行中的任务：sessionStorage 里有记录就重新加锁并查结果。只做一次；有生成在跑时留到下次再试。
     * @returns {Promise<boolean>} 是否找回了一单（整单结束后才 resolve）。
     */
    async function recoverChatImageJob() {
        if (recoveryDone) {
            return false;
        }
        const stored = readStoredJob();
        if (!stored || typeof stored.requestId !== 'string' || !stored.requestId) {
            recoveryDone = true;
            return false;
        }
        if (slot.job || activeRun) {
            recoveryDone = true;
            return false;
        }
        if (starting || state.engine.generating) {
            return false;
        }
        recoveryDone = true;
        const valid = typeof stored.contextKey === 'string' && stored.contextKey
            && typeof stored.chatId === 'string' && stored.chatId
            && typeof stored.prompt === 'string'
            && (stored.kind === 'new' || stored.kind === 'version');
        if (!valid) {
            clearStoredJob(stored.requestId);
            return false;
        }
        const startedAt = Number.isFinite(stored.startedAt) ? stored.startedAt : now();
        /** @type {ImageJob} */
        const job = {
            requestId: stored.requestId,
            status: 'pending',
            cacheKey: typeof stored.cacheKey === 'string' && stored.cacheKey ? stored.cacheKey : `${stored.contextKey}::${stored.chatId}`,
            contextKey: stored.contextKey,
            chatId: stored.chatId,
            groupMode: Boolean(stored.groupMode),
            kind: stored.kind,
            targetIdentity: typeof stored.targetIdentity === 'string' ? stored.targetIdentity : '',
            prompt: stored.prompt,
            negativePrompt: typeof stored.negativePrompt === 'string' ? stored.negativePrompt : '',
            params: stored.params && typeof stored.params === 'object' ? stored.params : {},
            provider: String(stored.provider || ''),
            model: String(stored.model || ''),
            origin: stored.origin === 'messages' ? 'messages' : 'manual',
            sourceCount: Number(stored.sourceCount) || 0,
            startedAt,
            ratio: Number(stored.ratio) > 0 ? Number(stored.ratio) : getImageRatio(stored.params),
            failure: null,
        };
        await startRun(job, { deadline: Math.max(startedAt + timeoutMs, now()) });
        return true;
    }

    return {
        setChatImageMode,
        setChatImageSubMode,
        updateChatImageDraft,
        clearChatImageDraft,
        generateChatImage,
        regenerateChatImage,
        editChatImagePrompt,
        cancelChatImageJob,
        retryChatImageJob,
        dismissChatImageJob,
        recoverChatImageJob,
    };
}

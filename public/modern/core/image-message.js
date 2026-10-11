/**
 * 会话内生成的图片消息：识别、构造、追加版本、切换版本、定位消息、解析失败。纯函数，不碰 DOM。
 *
 * 消息格式沿用旧版生图扩展（public/scripts/extensions/stable-diffusion/index.js 的 sendMessage），旧页面也能显示：
 *   { name, is_user: false, is_system: true, send_date, mes: '',
 *     extra: { media: [版本…], media_display: 'gallery', media_index, inline_image: false, image_generation: { version: 1 } } }
 * extra.media 里每一项是一个版本：{ url, type: 'image', title: 提示词, negative, source: 'generated', generation: {...} }。
 * is_system 让图片消息不进入后续文本上下文（旧引擎组提示词时过滤 is_system，public/script.js:4822）。
 */

export const IMAGE_MEDIA_SOURCE = 'generated';

/**
 * @param {any} message 聊天消息。
 * @returns {boolean} 是否为会话内生成的图片消息（也认旧版生图扩展写的隐藏图片消息）。
 */
export function isImageMessage(message) {
    return Boolean(message)
        && message.is_system === true
        && !message.is_user
        && Array.isArray(message.extra?.media)
        && message.extra.media.some(item => item && item.source === IMAGE_MEDIA_SOURCE && (item.type === 'image' || !item.type) && typeof item.url === 'string' && item.url);
}

/**
 * @param {any[]} messages 当前聊天的全部消息。
 * @returns {boolean} 最后一条是否是图片消息（是的话「继续」「重生成」不可用：旧引擎会删掉它或把文字续写进去）。
 */
export function isLastMessageImage(messages) {
    return Array.isArray(messages) && messages.length > 0 && isImageMessage(messages[messages.length - 1]);
}

/**
 * 消息身份：send_date + name + is_user。消息列表只渲染最后 N 条，下标会随「加载更早消息」变化，勾选和回写都按身份找消息。
 * @param {any} message 聊天消息。
 * @returns {string}
 */
export function messageIdentity(message) {
    return `${String(message?.send_date ?? '')}|${String(message?.name ?? '')}|${message?.is_user ? 1 : 0}`;
}

/**
 * @param {any[]} messages 消息列表。
 * @param {string} identity messageIdentity 的结果。
 * @returns {number} 找不到时为 -1；身份重复时取最后一条。
 */
export function findMessageIndexByIdentity(messages, identity) {
    if (!Array.isArray(messages) || !identity) {
        return -1;
    }
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messageIdentity(messages[index]) === identity) {
            return index;
        }
    }
    return -1;
}

/**
 * @param {any} message 消息。
 * @returns {boolean} 能否参与「从消息生成」：普通的用户 / 角色文本消息，排除图片消息和其他系统消息。
 */
export function isPromptSourceMessage(message) {
    return Boolean(message) && !message.is_system && typeof message.mes === 'string' && message.mes.trim().length > 0;
}

/**
 * 「从消息生成」默认勾选：最近 count 条可参与的消息（见 isPromptSourceMessage）。
 * @param {any[]} messages 当前聊天的全部消息。
 * @param {number} count 条数。
 * @returns {Set<string>} 消息身份集合。
 */
export function pickRecentPromptSources(messages, count) {
    const sources = Array.isArray(messages) ? messages.filter(isPromptSourceMessage) : [];
    const take = Math.max(0, Math.trunc(Number(count) || 0));
    return new Set((take ? sources.slice(-take) : []).map(messageIdentity));
}

/**
 * @typedef {object} GeneratedImage
 * @property {string} path 后端返回的原样路径，如 /user/images/莉亚/莉亚_2026-10-12@00h19m24s_1.png
 * @property {number} [width]
 * @property {number} [height]
 * @property {string} [mimeType]
 *
 * @typedef {object} ImageGenerationMeta
 * @property {string} prompt 提示词。
 * @property {string} [negativePrompt] 反向提示词。
 * @property {string} provider 供应商 id。
 * @property {string} model 模型名。
 * @property {Record<string, any>} [params] 实际发送的参数（width、height、quality…）。
 * @property {string} requestId 后端请求 id。
 * @property {'manual'|'messages'} [origin] 提示词来源：手动输入 / 从消息生成。
 * @property {number} [sourceCount] 从几条消息生成。
 * @property {number} [elapsedMs] 后端耗时。
 * @property {string} [createdAt] ISO 时间。
 */

/**
 * @param {GeneratedImage} image 后端返回的一张图。
 * @param {ImageGenerationMeta} meta 这次生成的信息。
 * @returns {Record<string, any>} extra.media 的一项。
 */
function toMediaItem(image, meta) {
    return {
        url: image.path,
        type: 'image',
        title: meta.prompt,
        negative: meta.negativePrompt || '',
        source: IMAGE_MEDIA_SOURCE,
        generation_type: meta.origin === 'messages' ? 'messages' : 'free',
        generation: {
            provider: meta.provider,
            model: meta.model,
            params: { ...(meta.params || {}) },
            width: Number.isFinite(image.width) ? image.width : null,
            height: Number.isFinite(image.height) ? image.height : null,
            mimeType: image.mimeType || '',
            requestId: meta.requestId,
            origin: meta.origin || 'manual',
            sourceCount: Number.isFinite(meta.sourceCount) ? meta.sourceCount : 0,
            elapsedMs: Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : null,
            createdAt: meta.createdAt || '',
        },
    };
}

/**
 * 新建一条图片消息；多张图依次作为多个版本，显示第一张。
 * @param {object} input 输入。
 * @param {string} input.name 消息署名（单聊用角色名，群聊用群名）。
 * @param {string} input.sendDate ISO 时间，作为消息身份的一部分，必须是新的。
 * @param {GeneratedImage[]} input.images 至少一张。
 * @param {ImageGenerationMeta} input.meta 生成信息。
 * @returns {Record<string, any>} 聊天消息。
 */
export function buildImageMessage({ name, sendDate, images, meta }) {
    if (!Array.isArray(images) || !images.length) {
        throw new Error('没有可写入的图片。');
    }
    return {
        name: String(name || ''),
        is_user: false,
        is_system: true,
        send_date: sendDate,
        mes: '',
        extra: {
            media: images.map(image => toMediaItem(image, { ...meta, createdAt: meta.createdAt || sendDate })),
            media_display: 'gallery',
            media_index: 0,
            inline_image: false,
            image_generation: { version: 1 },
        },
    };
}

/**
 * 给已有图片消息追加版本（「重新生成」），并切到新加的第一张。返回新对象，不修改传入的消息。
 * @param {any} message 图片消息。
 * @param {GeneratedImage[]} images 新图。
 * @param {ImageGenerationMeta} meta 生成信息。
 * @returns {Record<string, any>}
 */
export function appendImageVersions(message, images, meta) {
    if (!isImageMessage(message)) {
        throw new Error('目标消息不是图片消息。');
    }
    if (!Array.isArray(images) || !images.length) {
        throw new Error('没有可写入的图片。');
    }
    const media = [...message.extra.media, ...images.map(image => toMediaItem(image, meta))];
    return {
        ...message,
        extra: {
            ...message.extra,
            media,
            media_index: message.extra.media.length,
        },
    };
}

/**
 * @param {any} message 图片消息。
 * @returns {{ index: number, count: number, item: Record<string, any> | null }} 当前显示的版本（media_index 越界时夹到范围内）。
 */
export function getImageVersion(message) {
    const media = Array.isArray(message?.extra?.media) ? message.extra.media : [];
    if (!media.length) {
        return { index: 0, count: 0, item: null };
    }
    const raw = Number(message.extra.media_index);
    const index = Number.isSafeInteger(raw) ? Math.min(Math.max(raw, 0), media.length - 1) : 0;
    return { index, count: media.length, item: media[index] };
}

/**
 * 切换显示的版本。返回新对象；目标下标越界时夹到范围内。
 * @param {any} message 图片消息。
 * @param {number} index 目标下标。
 * @returns {Record<string, any>}
 */
export function setImageVersionIndex(message, index) {
    const count = Array.isArray(message?.extra?.media) ? message.extra.media.length : 0;
    const next = count ? Math.min(Math.max(Math.trunc(Number(index) || 0), 0), count - 1) : 0;
    return { ...message, extra: { ...message.extra, media_index: next } };
}

/**
 * 解析 /api/image-generation/* 的失败。apiFetch 失败时抛出的 Error 带 status 和 body（响应体前 2000 字）。
 * 后端失败体是 { error, message, detail?, outcome }，outcome 表示是否可能已经计费。
 * @param {any} error apiFetch 抛出的错误，或 AbortError / 网络错误。
 * @returns {{ code: string, message: string, detail: string, outcome: 'not-charged'|'unknown'|'charged', status: number | null, uncertain: boolean }}
 *   uncertain 为真表示没拿到后端结论（网络失败、超时、5xx 无结构体），应去查 /requests/:id 而不是直接判定失败。
 */
export function describeImageFailure(error) {
    const status = Number.isSafeInteger(error?.status) ? error.status : null;
    let body = null;
    if (typeof error?.body === 'string' && error.body.trim().startsWith('{')) {
        try {
            body = JSON.parse(error.body);
        } catch {
            body = null;
        }
    }
    if (body && typeof body.error === 'string') {
        const outcome = ['not-charged', 'unknown', 'charged'].includes(body.outcome) ? body.outcome : 'unknown';
        return {
            code: body.error,
            message: typeof body.message === 'string' ? body.message : '图片生成失败。',
            detail: typeof body.detail === 'string' ? body.detail : '',
            outcome,
            status,
            uncertain: false,
        };
    }
    const aborted = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    return {
        code: aborted ? 'client-timeout' : 'network-error',
        message: aborted ? '等待图片结果超时。' : '没有收到图片生成的结果。',
        detail: '',
        outcome: 'unknown',
        status,
        uncertain: true,
    };
}

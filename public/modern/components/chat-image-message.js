/**
 * 图片消息与生图任务卡片（WP3）。components/chat-message.js 和 chat-thread.js 通过下面几个函数接入：
 *   renderImageMessage(message, messageIndex, { isDeleting, managePanelHtml, selection })
 *       渲染一条图片消息（core/image-message.js 的 isImageMessage 为真时代替普通消息）；
 *       selection 是 chat-image-selection.js 的 getMessageSelection 结果，用来在勾选模式下变淡。
 *   renderImageJobCard()   当前聊天的生成中 / 失败 / 结果未知卡片，追加在消息列表末尾
 *   hasVisibleImageJob()   当前聊天是否有要显示的任务卡片（空聊天时据此仍渲染消息列表）
 *   renderImageLightbox()  大图浮层
 *
 * 版本切换、大图、复制提示词的动作在 actions/chat-image-view.js；按钮事件在 routes/chat-image-message-events.js。
 * 「重新生成」「编辑提示词」和任务卡片上的停止 / 重试 / 移除由 actions/chat-image-generation.js（WP2）提供。
 * 等待秒数由事件文件的 afterRender 定时就地更新 [data-image-job-elapsed]，不整页重渲染。
 *
 * @param {any} ctx 聊天路由上下文。
 */
import { ensureChatImageState } from '../core/chat-image-state.js';
import { getImageOptionTables, getImageProvider } from '../core/image-generation-config.js';
import { findMessageIndexByIdentity, getImageVersion, isImageMessage, messageIdentity } from '../core/image-message.js';

/** 展开过的提示词（`${cacheKey}|${消息身份}`）。重渲染会重建 <details>，靠它恢复展开状态；由事件文件的 toggle 监听维护。 */
const openPromptKeys = new Set();

/**
 * 记下某条图片消息的提示词是否展开（routes/chat-image-message-events.js 在 <details> 的 toggle 事件里调用）。
 * @param {string} key renderImageMessage 写在 data-image-message-prompt 上的键。
 * @param {boolean} open 是否展开。
 */
export function rememberImagePromptOpen(key, open) {
    if (!key) {
        return;
    }
    if (open) {
        openPromptKeys.add(key);
    } else {
        openPromptKeys.delete(key);
    }
}

/**
 * 图片地址只接受站内路径、http(s)、blob 和 data:image，其他协议（如 javascript:）一律不输出，聊天文件可能来自导入。
 * 后端给的是未编码的原样路径（可能含空格和中文），站内路径用 encodeURI 编码；结果还要再经 escapeHtml 才能放进属性。
 * @param {unknown} url extra.media 里的 url。
 * @returns {string} 可放进 src / href 的地址，不安全或无效时为空串。
 */
export function toSafeImageUrl(url) {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) {
        return '';
    }
    try {
        if (raw.startsWith('/') && !raw.startsWith('//')) {
            return encodeURI(raw);
        }
        if (/^data:image\//i.test(raw)) {
            return raw;
        }
        if (/^(https?:|blob:)/i.test(raw)) {
            return new URL(raw).href;
        }
    } catch {
        return '';
    }
    return '';
}

/**
 * @param {number} startedAt 开始时间（毫秒）。
 * @param {number} [now] 当前时间（毫秒）。
 * @returns {number} 已等待的整秒数，不小于 0。
 */
export function getElapsedSeconds(startedAt, now = Date.now()) {
    const start = Number(startedAt);
    return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
}

function truncate(text, max) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * 生成中卡片的高宽比：job.ratio 无效时按方图，极端值夹到 1:4 ~ 4:1。
 * @param {unknown} ratio 高宽比。
 * @returns {number}
 */
function normalizeRatio(ratio) {
    const value = Number(ratio);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.max(value, 0.25), 4) : 1;
}

/**
 * @param {Record<string, any> | null} item extra.media 的一项。
 * @returns {string} 提示词来源：由 N 条消息生成 / 手动输入。
 */
export function describeImageSource(item) {
    const generation = item?.generation || {};
    if (generation.origin === 'messages') {
        const count = Number(generation.sourceCount);
        return count > 0 ? `由 ${count} 条消息生成` : '由消息生成';
    }
    return '手动输入';
}

function describeSize(generation) {
    const params = generation.params || {};
    const width = Number(generation.width) || Number(params.width);
    const height = Number(generation.height) || Number(params.height);
    if (width > 0 && height > 0) {
        return `${width}×${height}`;
    }
    return typeof params.aspectRatio === 'string' ? params.aspectRatio : '';
}

function describeQuality(generation) {
    const quality = String(generation.params?.quality || '');
    if (!quality) {
        return '';
    }
    const option = getImageOptionTables(String(generation.provider || ''), String(generation.model || '')).qualities.find(([value]) => value === quality);
    return `质量 ${option ? option[1] : quality}`;
}

function describeElapsed(generation) {
    const ms = Number(generation.elapsedMs);
    return Number.isFinite(ms) && ms > 0 ? `耗时 ${Math.max(1, Math.round(ms / 1000))} 秒` : '';
}

function describeProvider(id) {
    const value = String(id || '');
    return value ? (getImageProvider(value)?.label || value) : '';
}

/**
 * 图片下面的一行参数：供应商 · 模型 · 尺寸 · 质量 · 耗时，没有记录的项不显示。
 * @param {Record<string, any> | null} item extra.media 的一项。
 * @returns {string}
 */
export function describeImageInfo(item) {
    const generation = item?.generation;
    if (!generation || typeof generation !== 'object') {
        return '';
    }
    return [
        describeProvider(generation.provider),
        String(generation.model || ''),
        describeSize(generation),
        describeQuality(generation),
        describeElapsed(generation),
    ].filter(Boolean).join(' · ');
}

/**
 * 大图浮层里的参数表：比参数行多出比例、风格、种子、步数和生成时间。
 * @param {Record<string, any> | null} item extra.media 的一项。
 * @returns {[string, string][]}
 */
function describeImageParams(item) {
    const generation = item?.generation;
    if (!generation || typeof generation !== 'object') {
        return [];
    }
    const params = generation.params || {};
    const size = describeSize(generation);
    /** @type {[string, any][]} */
    const rows = [
        ['供应商', describeProvider(generation.provider)],
        ['模型', generation.model],
        ['尺寸', size],
        ['比例', params.aspectRatio && params.aspectRatio !== size ? params.aspectRatio : ''],
        ['质量', describeQuality(generation).replace(/^质量 /, '')],
        ['风格', params.style],
        ['种子', params.seed],
        ['步数', params.steps],
        ['耗时', describeElapsed(generation).replace(/^耗时 /, '')],
    ];
    return rows
        .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
        .map(([label, value]) => [label, String(value)]);
}

export function createChatImageMessageComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        getCurrentDraftKey,
        getSelectedChatMessages,
    } = ctx;

    function getEntityName() {
        try {
            const entity = typeof ctx.getSelectedChatEntity === 'function' ? ctx.getSelectedChatEntity() : null;
            return (entity && typeof ctx.getChatEntityName === 'function' ? ctx.getChatEntityName(entity) : '') || '';
        } catch {
            return '';
        }
    }

    function attr(value) {
        return escapeHtml(String(value ?? ''));
    }

    function imageAlt(item) {
        const prompt = truncate(item?.title, 80);
        return prompt ? `生成的图片：${prompt}` : '生成的图片';
    }

    /**
     * 当前聊天要显示的任务卡片。新消息的任务总是显示；给已有消息加版本的任务进行中时改为在那条消息上盖一层，
     * 失败或结果未知时才显示卡片。目标消息不在当前列表里（已删除或被「加载更早消息」折叠）时也显示卡片，保证能停止等待。
     * @returns {import('../core/chat-image-state.js').ImageJob | null}
     */
    function getVisibleJob() {
        const job = ensureChatImageState(state).job;
        if (!job || job.cacheKey !== getCurrentDraftKey()) {
            return null;
        }
        if (job.kind !== 'version' || job.status !== 'pending') {
            return job;
        }
        const messages = getSelectedChatMessages();
        const index = findMessageIndexByIdentity(messages, job.targetIdentity);
        const limit = typeof ctx.getCurrentMessageLimit === 'function' ? Number(ctx.getCurrentMessageLimit()) : Infinity;
        const hidden = index < 0 || (Number.isFinite(limit) && index < messages.length - limit);
        return hidden ? job : null;
    }

    function hasVisibleImageJob() {
        return Boolean(getVisibleJob());
    }

    // 正在给这条消息生成新版本：在图片上盖一层转圈和等待秒数
    function isVersionPendingFor(message) {
        const job = ensureChatImageState(state).job;
        return Boolean(job)
            && job.status === 'pending'
            && job.kind === 'version'
            && job.cacheKey === getCurrentDraftKey()
            && job.targetIdentity === messageIdentity(message);
    }

    function renderTags() {
        return `
                <span class="tag image-message-tag is-accent"><i class="fa-solid fa-image" aria-hidden="true"></i>图片</span>
                <span class="tag image-message-tag" title="保存为 is_system 消息，后续文本回复看不到它"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i>不进入上下文</span>`;
    }

    function renderVersionSwitcher(messageIndex, version) {
        if (version.count <= 1) {
            return '';
        }
        const generating = Boolean(state.engine?.generating);
        const busyTitle = '生成中不能切换版本';
        return `
                <span class="image-message-versions" role="group" aria-label="图片版本">
                    <button class="icon-button mini" type="button" data-image-message-version="${messageIndex}" data-image-message-direction="-1" title="${generating ? busyTitle : '上一个版本'}" aria-label="上一个版本" ${generating || version.index === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <span class="image-message-version-label" data-image-message-version-label>${version.index + 1}/${version.count}</span>
                    <button class="icon-button mini" type="button" data-image-message-version="${messageIndex}" data-image-message-direction="1" title="${generating ? busyTitle : '下一个版本'}" aria-label="下一个版本" ${generating || version.index >= version.count - 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                    </button>
                </span>`;
    }

    function renderVersionOverlay() {
        const job = ensureChatImageState(state).job;
        return `
            <div class="image-message-overlay" data-image-message-pending>
                <span class="image-message-overlay-text">
                    <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                    正在生成新版本 · 已等待 <span data-image-job-elapsed>${getElapsedSeconds(job?.startedAt)}</span> 秒
                </span>
                <button class="secondary-button compact-button" type="button" data-image-job-cancel aria-label="停止等待新版本">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    停止等待
                </button>
            </div>`;
    }

    /**
     * @param {any} message 图片消息。
     * @param {number} messageIndex 消息在整个聊天里的下标。
     * @param {{ isDeleting?: boolean, managePanelHtml?: string, selection?: { className?: string, attrs?: string, controlHtml?: string } }} [options] 选项。
     * @returns {string}
     */
    function renderImageMessage(message, messageIndex, options = {}) {
        const { isDeleting = false, managePanelHtml = '', selection = {} } = options;
        const version = getImageVersion(message);
        const item = version.item || {};
        const url = toSafeImageUrl(item.url);
        const prompt = String(item.title || '');
        const negative = String(item.negative || '');
        const info = describeImageInfo(item);
        const promptKey = `${getCurrentDraftKey()}|${messageIdentity(message)}`;
        const generating = Boolean(state.engine?.generating);

        return `
        <article class="message image-message ${selection.className || ''}" ${selection.attrs || ''} data-image-message-index="${messageIndex}">
            <header class="message-meta">
                <span class="image-message-heading">
                    ${selection.controlHtml || ''}
                    <strong>${escapeHtml(message.name || '图片')}</strong>
                    ${renderTags()}
                </span>
                <span class="message-actions">
                    ${renderVersionSwitcher(messageIndex, version)}
                    <span>${escapeHtml(formatDate(message.send_date))}</span>
                    <button class="icon-button mini" type="button" data-delete-message="${messageIndex}" title="编辑或删除消息" aria-label="编辑或删除消息" ${isDeleting ? 'disabled' : ''}>
                        <i class="fa-solid fa-ellipsis"></i>
                    </button>
                </span>
            </header>
            <div class="image-message-frame">
                ${url ? `
                    <button class="image-message-open" type="button" data-image-message-open="${messageIndex}" aria-label="查看大图" title="查看大图">
                        <img class="image-message-image" src="${attr(url)}" alt="${attr(imageAlt(item))}" decoding="async">
                    </button>
                ` : '<p class="image-message-missing"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> 图片地址无效，无法显示。</p>'}
                ${isVersionPendingFor(message) ? renderVersionOverlay() : ''}
            </div>
            <details class="image-message-prompt" data-image-message-prompt="${attr(promptKey)}" ${openPromptKeys.has(promptKey) ? 'open' : ''}>
                <summary>
                    <i class="fa-solid fa-chevron-right image-message-prompt-chevron" aria-hidden="true"></i>
                    提示词 · ${escapeHtml(describeImageSource(item))}
                </summary>
                <div class="image-message-prompt-text">${prompt ? escapeHtml(prompt) : '<span class="image-message-muted">没有记录提示词。</span>'}</div>
                ${negative ? `<div class="image-message-prompt-text image-message-negative"><span class="image-message-muted">反向提示词：</span>${escapeHtml(negative)}</div>` : ''}
            </details>
            ${info ? `<p class="image-message-info" data-image-message-info>${escapeHtml(info)}</p>` : ''}
            <div class="image-message-actions">
                <button class="secondary-button compact-button" type="button" data-image-message-regenerate="${messageIndex}" aria-label="重新生成：用同样的提示词和参数再生成一个版本" title="${generating ? '生成中不能重新生成' : '用同样的提示词和参数再生成一个版本'}" ${generating ? 'disabled' : ''}>
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    重新生成
                </button>
                <button class="secondary-button compact-button" type="button" data-image-message-edit="${messageIndex}" aria-label="编辑提示词：填回输入框并切到图片模式">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    编辑提示词
                </button>
                <button class="secondary-button compact-button" type="button" data-image-message-copy="${messageIndex}" aria-label="复制提示词" ${prompt ? '' : 'disabled'}>
                    <i class="fa-solid fa-copy" aria-hidden="true"></i>
                    复制提示词
                </button>
                ${url ? `
                    <a class="secondary-button compact-button" href="${attr(url)}" download data-image-message-download="${messageIndex}" aria-label="下载图片">
                        <i class="fa-solid fa-download" aria-hidden="true"></i>
                        下载
                    </a>
                ` : ''}
            </div>
            ${isDeleting ? managePanelHtml : ''}
        </article>
    `;
    }

    function renderJobHead(job) {
        return `
            <header class="message-meta">
                <span class="image-message-heading">
                    <strong>${escapeHtml(getEntityName() || '图片')}</strong>
                    <span class="tag image-message-tag is-accent"><i class="fa-solid fa-image" aria-hidden="true"></i>图片</span>
                    ${job.kind === 'version' ? '<span class="tag image-message-tag" title="给已有图片消息生成的新版本">新版本</span>' : ''}
                </span>
                <span>${escapeHtml(formatDate(job.startedAt))}</span>
            </header>`;
    }

    function renderJobParams(job) {
        const params = job.params || {};
        return [
            describeProvider(job.provider),
            String(job.model || ''),
            describeSize({ params }),
            describeQuality({ provider: job.provider, model: job.model, params }),
        ].filter(Boolean).join(' · ');
    }

    function renderPendingJob(job) {
        const ratio = normalizeRatio(job.ratio);
        const params = renderJobParams(job);
        return `
        <article class="message image-message image-job-card is-pending" data-image-job="pending" data-image-job-kind="${attr(job.kind)}" aria-busy="true">
            ${renderJobHead(job)}
            <div class="image-job-skeleton" style="aspect-ratio: 1 / ${ratio.toFixed(4)}">
                <div class="image-job-skeleton-text">
                    <i class="fa-solid fa-paintbrush" aria-hidden="true"></i>
                    <span>${job.kind === 'version' ? '正在生成新版本' : '正在生成'} · 已等待 <span data-image-job-elapsed>${getElapsedSeconds(job.startedAt)}</span> 秒</span>
                    ${params ? `<span class="image-job-params">${escapeHtml(params)}</span>` : ''}
                </div>
            </div>
            <div class="image-message-actions">
                <button class="secondary-button compact-button" type="button" data-image-job-cancel aria-label="停止等待图片结果">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    停止等待
                </button>
                <span class="image-job-note">停止只是不再等待；已提交的请求，供应商可能照常计费。</span>
            </div>
        </article>
    `;
    }

    function renderFailureDetail(failure) {
        const detail = String(failure?.detail || '').trim();
        return detail ? `<p class="image-job-detail">${escapeHtml(detail)}</p>` : '';
    }

    function renderFailedJob(job) {
        const failure = job.failure || null;
        const generating = Boolean(state.engine?.generating);
        return `
        <article class="message image-message image-job-card is-failed" data-image-job="failed" data-image-job-kind="${attr(job.kind)}">
            ${renderJobHead(job)}
            <div class="image-job-title" role="alert">
                <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                ${job.kind === 'version' ? '新版本生成失败' : '图片生成失败'}
            </div>
            <p class="image-job-text">${escapeHtml(failure?.message || '图片生成失败。')} 这次没有计费，也没有写入聊天文件。</p>
            ${renderFailureDetail(failure)}
            <div class="image-message-actions">
                <button class="secondary-button compact-button" type="button" data-image-job-edit aria-label="编辑提示词后重新生成">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
                    编辑提示词
                </button>
                <button class="secondary-button compact-button" type="button" data-image-job-retry aria-label="用同样的提示词重试" ${generating ? 'disabled' : ''}>
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    重试
                </button>
                <button class="secondary-button compact-button" type="button" data-image-job-dismiss aria-label="移除这张失败卡片">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    移除
                </button>
            </div>
        </article>
    `;
    }

    function renderUnknownJob(job) {
        const failure = job.failure || null;
        const generating = Boolean(state.engine?.generating);
        const folder = `/user/images/${getEntityName() || '<角色名>'}/`;
        const billing = failure?.outcome === 'charged' ? '供应商已经计费。' : '供应商可能已经生成并计费。';
        return `
        <article class="message image-message image-job-card is-unknown" data-image-job="unknown" data-image-job-kind="${attr(job.kind)}">
            ${renderJobHead(job)}
            <div class="image-job-title" role="alert">
                <i class="fa-solid fa-clock" aria-hidden="true"></i>
                结果未知
            </div>
            <p class="image-job-text">
                ${escapeHtml(failure?.message || '没有收到图片生成的结果。')} ${billing}若图片已生成，会出现在 <code data-image-job-folder>${escapeHtml(folder)}</code>；这里不会自动重试。
            </p>
            ${renderFailureDetail(failure)}
            <div class="image-message-actions">
                <button class="secondary-button compact-button" type="button" data-image-job-retry aria-label="重新提交（会再次计费）" ${generating ? 'disabled' : ''}>
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    重新提交（会再次计费）
                </button>
                <button class="secondary-button compact-button" type="button" data-image-job-dismiss aria-label="移除这张结果未知卡片">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    移除
                </button>
            </div>
        </article>
    `;
    }

    function renderImageJobCard() {
        const job = getVisibleJob();
        if (!job) {
            return '';
        }
        if (job.status === 'pending') {
            return renderPendingJob(job);
        }
        if (job.status === 'failed' && job.failure?.outcome === 'not-charged') {
            return renderFailedJob(job);
        }
        return renderUnknownJob(job);
    }

    /**
     * 大图浮层对应的消息：按身份在当前聊天里找，聊天换了、消息删了或不再是图片消息时为 null。
     * @returns {{ message: any, messageIndex: number, item: Record<string, any>, mediaIndex: number, count: number } | null}
     */
    function resolveLightbox() {
        const lightbox = ensureChatImageState(state).lightbox;
        if (!lightbox || lightbox.cacheKey !== getCurrentDraftKey()) {
            return null;
        }
        const messages = getSelectedChatMessages();
        const messageIndex = findMessageIndexByIdentity(messages, lightbox.identity);
        const message = messageIndex >= 0 ? messages[messageIndex] : null;
        if (!isImageMessage(message)) {
            return null;
        }
        const media = message.extra.media;
        const raw = Math.trunc(Number(lightbox.index));
        const mediaIndex = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), media.length - 1) : getImageVersion(message).index;
        const item = media[mediaIndex];
        return item ? { message, messageIndex, item, mediaIndex, count: media.length } : null;
    }

    function renderImageLightbox() {
        const target = resolveLightbox();
        if (!target) {
            return '';
        }
        const { messageIndex, item, mediaIndex, count } = target;
        const url = toSafeImageUrl(item.url);
        const prompt = String(item.title || '');
        const negative = String(item.negative || '');
        const rows = [
            ['来源', describeImageSource(item)],
            ...(count > 1 ? [['版本', `${mediaIndex + 1}/${count}`]] : []),
            ...describeImageParams(item),
        ];
        return `
        <div class="image-lightbox" role="dialog" aria-modal="true" aria-label="图片详情" data-image-lightbox data-image-lightbox-message="${messageIndex}" data-image-lightbox-media="${mediaIndex}">
            <div class="image-lightbox-stage">
                ${url ? `<img class="image-lightbox-image" src="${attr(url)}" alt="${attr(imageAlt(item))}" data-image-lightbox-image>` : '<p class="image-lightbox-missing">图片地址无效，无法显示。</p>'}
                ${count > 1 ? `
                    <div class="image-lightbox-nav" data-image-lightbox-nav>
                        <button class="icon-button" type="button" data-image-lightbox-step="-1" aria-label="上一个版本" title="上一个版本" ${mediaIndex === 0 ? 'disabled' : ''}>
                            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
                        </button>
                        <span>${mediaIndex + 1}/${count}</span>
                        <button class="icon-button" type="button" data-image-lightbox-step="1" aria-label="下一个版本" title="下一个版本" ${mediaIndex >= count - 1 ? 'disabled' : ''}>
                            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        </button>
                    </div>
                ` : ''}
            </div>
            <aside class="image-lightbox-panel" data-image-lightbox-panel>
                <div class="image-lightbox-head">
                    <h3>图片详情</h3>
                    <button class="icon-button" type="button" data-image-lightbox-close="icon" aria-label="关闭大图" title="关闭（Esc）">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                <section class="image-lightbox-section">
                    <span class="field-label">提示词</span>
                    <div class="image-lightbox-text" data-image-lightbox-prompt>${prompt ? escapeHtml(prompt) : '<span class="image-message-muted">没有记录提示词。</span>'}</div>
                </section>
                ${negative ? `
                    <section class="image-lightbox-section">
                        <span class="field-label">反向提示词</span>
                        <div class="image-lightbox-text" data-image-lightbox-negative>${escapeHtml(negative)}</div>
                    </section>
                ` : ''}
                <dl class="image-lightbox-meta">
                    ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
                    <dt>文件</dt><dd class="image-lightbox-path" data-image-lightbox-path>${escapeHtml(String(item.url || ''))}</dd>
                </dl>
                <div class="image-lightbox-actions">
                    <button class="secondary-button" type="button" data-image-lightbox-copy="${messageIndex}" aria-label="复制提示词" ${prompt ? '' : 'disabled'}>
                        <i class="fa-solid fa-copy" aria-hidden="true"></i>
                        复制提示词
                    </button>
                    <button class="secondary-button" type="button" data-image-lightbox-edit="${messageIndex}" aria-label="编辑提示词：关闭大图，填回输入框">
                        <i class="fa-solid fa-pen" aria-hidden="true"></i>
                        编辑提示词
                    </button>
                    ${url ? `
                        <a class="primary-button" href="${attr(url)}" download data-image-lightbox-download aria-label="下载图片">
                            <i class="fa-solid fa-download" aria-hidden="true"></i>
                            下载
                        </a>
                    ` : ''}
                    <button class="secondary-button" type="button" data-image-lightbox-close="button" aria-label="关闭大图">
                        关闭
                    </button>
                </div>
            </aside>
        </div>
    `;
    }

    return {
        renderImageMessage,
        renderImageJobCard,
        hasVisibleImageJob,
        renderImageLightbox,
    };
}

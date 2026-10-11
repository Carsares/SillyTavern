/**
 * 图片消息的事件（WP3）：版本切换、大图打开 / 关闭、复制提示词、重新生成、编辑提示词、生成中卡片上的停止 / 重试 / 移除。
 * 转发约定见 routes/chat-tools-events.js 顶部注释。
 *
 * 版本、大图、复制的动作在 actions/chat-image-view.js；重新生成、编辑提示词和任务卡片的按钮调用 WP2 的
 * regenerateChatImage(messageIndex)、editChatImagePrompt(messageIndex)、cancelChatImageJob()、retryChatImageJob()、
 * dismissChatImageJob()。任务卡片上的「编辑提示词」没有对应消息，调用 editChatImagePrompt() 不带参数，表示用当前任务的提示词。
 * 下载是 <a download>，不拦截，交给浏览器。
 *
 * afterRender 做三件事：给提示词 <details> 挂 toggle 监听记住展开状态；有进行中的任务时每秒就地更新等待秒数（不重渲染）；
 * 大图打开时把焦点放到关闭按钮，大图状态已失效（换了聊天、消息被删）时清掉它。
 *
 * @param {any} ctx 聊天路由上下文。
 * @returns {{ handleClick?: Function, handleInput?: Function, handleChange?: Function, handleKeydown?: Function, afterRender?: Function }}
 */
import { rememberImagePromptOpen, getElapsedSeconds } from '../components/chat-image-message.js';
import { ensureChatImageState } from '../core/chat-image-state.js';

const lightboxSelector = '[data-image-lightbox]';
const elapsedSelector = '[data-image-job-elapsed]';

export function bindChatImageMessageEvents(ctx) {
    const { state, render, showToast } = ctx;
    /** @type {ReturnType<typeof setInterval> | null} */
    let elapsedTimer = null;

    async function run(title, action) {
        try {
            await action();
        } catch (error) {
            state.errors.push({ key: 'chat-image-message', message: error.message });
            showToast(title, error.message);
            render();
        }
    }

    // WP2 的动作在集成后才有；缺失时提示而不是抛出 TypeError
    function callFeature(name, title, ...args) {
        return run(title, async () => {
            if (typeof ctx[name] !== 'function') {
                throw new Error('这个操作暂不可用。');
            }
            await ctx[name](...args);
        });
    }

    function isDisabled(element) {
        return Boolean(element) && /** @type {HTMLButtonElement} */ (element).disabled === true;
    }

    async function handleLightboxClick(target, lightbox) {
        const messageIndex = lightbox.dataset.imageLightboxMessage;
        const mediaIndex = Number(lightbox.dataset.imageLightboxMedia);

        const stepButton = target.closest('[data-image-lightbox-step]');
        if (stepButton) {
            if (!isDisabled(stepButton)) {
                await run('切换版本失败', () => ctx.openChatImageLightbox(messageIndex, mediaIndex + Number(stepButton.dataset.imageLightboxStep)));
            }
            return true;
        }

        const copyButton = target.closest('[data-image-lightbox-copy]');
        if (copyButton) {
            if (!isDisabled(copyButton)) {
                await run('复制提示词失败', () => ctx.copyChatImagePrompt(copyButton.dataset.imageLightboxCopy, mediaIndex));
            }
            return true;
        }

        const editButton = target.closest('[data-image-lightbox-edit]');
        if (editButton) {
            // 先关大图（不渲染），编辑动作自己会渲染输入框
            ctx.closeChatImageLightbox({ silent: true });
            await callFeature('editChatImagePrompt', '编辑提示词失败', editButton.dataset.imageLightboxEdit);
            return true;
        }

        if (target.closest('[data-image-lightbox-download]')) {
            return true;
        }

        // 关闭按钮，或点在图片和侧栏以外的遮罩上
        if (target.closest('[data-image-lightbox-close]')
            || !(target.closest('[data-image-lightbox-panel]') || target.closest('[data-image-lightbox-nav]') || target.closest('[data-image-lightbox-image]'))) {
            ctx.closeChatImageLightbox();
        }
        return true;
    }

    const jobButtons = [
        ['[data-image-job-cancel]', 'cancelChatImageJob', '停止等待失败'],
        ['[data-image-job-retry]', 'retryChatImageJob', '重新提交失败'],
        ['[data-image-job-dismiss]', 'dismissChatImageJob', '移除失败'],
        ['[data-image-job-edit]', 'editChatImagePrompt', '编辑提示词失败'],
    ];

    async function handleClick(event) {
        const target = event?.target && typeof event.target.closest === 'function' ? event.target : null;
        if (!target) {
            return false;
        }

        const lightbox = target.closest(lightboxSelector);
        if (lightbox) {
            return handleLightboxClick(target, lightbox);
        }

        const versionButton = target.closest('[data-image-message-version]');
        if (versionButton) {
            if (!isDisabled(versionButton)) {
                await run('切换图片版本失败', () => ctx.selectChatImageVersion(versionButton.dataset.imageMessageVersion, Number(versionButton.dataset.imageMessageDirection)));
            }
            return true;
        }

        const openButton = target.closest('[data-image-message-open]');
        if (openButton) {
            await run('打开大图失败', () => ctx.openChatImageLightbox(openButton.dataset.imageMessageOpen));
            return true;
        }

        const regenerateButton = target.closest('[data-image-message-regenerate]');
        if (regenerateButton) {
            if (!isDisabled(regenerateButton)) {
                await callFeature('regenerateChatImage', '重新生成失败', Number(regenerateButton.dataset.imageMessageRegenerate));
            }
            return true;
        }

        const editButton = target.closest('[data-image-message-edit]');
        if (editButton) {
            await callFeature('editChatImagePrompt', '编辑提示词失败', Number(editButton.dataset.imageMessageEdit));
            return true;
        }

        const copyButton = target.closest('[data-image-message-copy]');
        if (copyButton) {
            if (!isDisabled(copyButton)) {
                await run('复制提示词失败', () => ctx.copyChatImagePrompt(copyButton.dataset.imageMessageCopy));
            }
            return true;
        }

        if (target.closest('[data-image-message-download]')) {
            return true;
        }

        for (const [selector, name, title] of jobButtons) {
            const button = target.closest(selector);
            if (button) {
                if (!isDisabled(button)) {
                    await callFeature(name, title);
                }
                return true;
            }
        }

        return false;
    }

    // Esc 只在大图真的显示着时处理，其余情况交给抽屉和全局快捷键
    function handleKeydown(event) {
        if (event?.key !== 'Escape' || typeof document === 'undefined' || !document.querySelector(lightboxSelector)) {
            return false;
        }
        event.preventDefault();
        ctx.closeChatImageLightbox();
        return true;
    }

    function stopElapsedTimer() {
        if (elapsedTimer) {
            clearInterval(elapsedTimer);
            elapsedTimer = null;
        }
    }

    // 就地更新等待秒数；任务结束或页面上没有秒数了就停表
    function tickElapsed() {
        const job = ensureChatImageState(state).job;
        const nodes = document.querySelectorAll(elapsedSelector);
        if (job?.status !== 'pending' || !nodes.length) {
            stopElapsedTimer();
            return;
        }
        const text = String(getElapsedSeconds(job.startedAt));
        for (const node of nodes) {
            if (node.textContent !== text) {
                node.textContent = text;
            }
        }
    }

    function syncElapsedTimer() {
        const job = ensureChatImageState(state).job;
        if (job?.status !== 'pending' || !document.querySelector(elapsedSelector)) {
            stopElapsedTimer();
            return;
        }
        tickElapsed();
        elapsedTimer ??= setInterval(tickElapsed, 1000);
    }

    function bindPromptToggles() {
        for (const details of document.querySelectorAll('details[data-image-message-prompt]')) {
            const element = /** @type {HTMLDetailsElement} */ (details);
            element.addEventListener('toggle', () => rememberImagePromptOpen(element.dataset.imageMessagePrompt || '', element.open));
        }
    }

    function syncLightbox() {
        const slot = ensureChatImageState(state);
        const lightbox = document.querySelector(lightboxSelector);
        if (!lightbox) {
            // 换了聊天、消息被删或进了 Agent 模式：浮层没渲染出来，状态也不再保留，免得回到原聊天时又弹出来
            slot.lightbox = null;
            return;
        }
        if (!lightbox.contains(document.activeElement)) {
            /** @type {HTMLElement | null} */ (lightbox.querySelector('[data-image-lightbox-close]'))?.focus();
        }
    }

    function afterRender() {
        if (typeof document === 'undefined') {
            return;
        }
        bindPromptToggles();
        syncElapsedTimer();
        syncLightbox();
    }

    return {
        handleClick,
        handleKeydown,
        afterRender,
    };
}

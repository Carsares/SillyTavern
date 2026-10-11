/**
 * 聊天输入框图片模式的事件（WP2）：文本 / 图片切换、子模式切换、提示词与参数输入、生成、清空、停止等待、Ctrl/⌘+Enter、
 * 图片模型标签的弹层，以及渲染后的几件事（刷新后找回任务、按需读取可用参数、提示词框定高和聚焦）。
 * 转发约定见 routes/chat-tools-events.js 顶部注释：处理函数返回 true 表示已处理。
 * 业务动作在 actions/chat-image-generation.js，经 ctx 调用。
 *
 * 「去设置中心配置 / 修改」按钮带 data-route="api"，路由器会先于聊天页的点击处理它；这里在渲染后给按钮直接挂一个点击监听，
 * 在冒泡到路由器之前把设置中心「模型连接」切到「图片模型」（state.settingsConnectionView）。
 *
 * @param {any} ctx 聊天路由上下文。
 * @returns {{ handleClick?: Function, handleInput?: Function, handleChange?: Function, handleKeydown?: Function, afterRender?: Function }}
 */
import { getChatImageComposerState } from '../actions/chat-image-generation.js';
import { peekChatImageView } from '../core/chat-image-state.js';
import { getCachedImageCapabilities } from '../core/image-generation-capabilities.js';
import { getImageConfigReadiness, getImageGenerationConfig } from '../core/image-generation-config.js';
import { fitComposerInput } from './chat-input-events.js';

const SETTINGS_CONNECTION_VIEW_KEY = 'st-modern-settings-connection-view';

/** 已挂过「去设置中心」监听的按钮（每次渲染都是新按钮，这里只防同一个按钮挂两次）。 */
const boundSettingsButtons = new WeakSet();

export function bindChatImageEvents(ctx) {
    const { state, render, showToast } = ctx;

    /**
     * 调用业务动作；失败时提示并重绘，不让异常冒到全局。
     * @param {string} name 动作名。
     * @param {string} title 失败提示的标题。
     * @param {...any} args 参数。
     */
    async function call(name, title, ...args) {
        if (typeof ctx[name] !== 'function') {
            return;
        }
        try {
            await ctx[name](...args);
        } catch (error) {
            showToast(title, error?.message || String(error));
            render();
        }
    }

    /** @returns {any} 当前聊天已有的图片界面状态；没有时为 null（只读，不创建）。 */
    function getView() {
        const key = typeof ctx.getCurrentDraftKey === 'function' && state.selected?.chat ? ctx.getCurrentDraftKey() : '';
        return key ? peekChatImageView(state, key) : null;
    }

    function updateGenerateButton(prompt) {
        const button = document.querySelector('[data-chat-image-generate]');
        if (button instanceof HTMLButtonElement && !state.engine.generating) {
            const config = getImageGenerationConfig(state.settings);
            const supported = getCachedImageCapabilities(state, config)?.supported !== false;
            button.disabled = !prompt.trim() || !supported;
        }
        const clear = document.querySelector('[data-chat-image-clear]');
        if (clear instanceof HTMLButtonElement && !state.engine.generating) {
            clear.disabled = !prompt;
        }
    }

    function closeModelPopover() {
        const composer = getChatImageComposerState(state);
        if (!composer.modelChipOpen) {
            return false;
        }
        composer.modelChipOpen = false;
        render();
        return true;
    }

    async function handleClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {
            return false;
        }
        const modeButton = target.closest('[data-chat-image-mode]');
        if (modeButton instanceof HTMLElement) {
            if (modeButton.dataset.chatImageMode === 'text' && getView()?.autoStep === 2) {
                // 离开图片模式时不再等正在生成的提示词（actions/chat-image-prompt.js）
                ctx.cancelChatImagePrompt?.();
            }
            await call('setChatImageMode', '切换输入模式失败', modeButton.dataset.chatImageMode);
            return true;
        }
        const subButton = target.closest('[data-chat-image-sub]');
        if (subButton instanceof HTMLElement) {
            if (subButton.dataset.chatImageSub === 'manual') {
                ctx.cancelChatImagePrompt?.();
            }
            await call('setChatImageSubMode', '切换提示词来源失败', subButton.dataset.chatImageSub);
            return true;
        }
        if (target.closest('[data-chat-image-generate]')) {
            await call('generateChatImage', '图片生成失败');
            return true;
        }
        if (target.closest('[data-chat-image-clear]')) {
            await call('clearChatImageDraft', '清空失败');
            return true;
        }
        if (target.closest('[data-chat-image-cancel]')) {
            await call('cancelChatImageJob', '停止等待失败');
            return true;
        }
        if (target.closest('[data-chat-image-advanced-toggle]')) {
            const view = getView();
            if (view) {
                await call('updateChatImageDraft', '展开高级参数失败', { showAdvanced: !view.showAdvanced });
            }
            return true;
        }
        if (target.closest('[data-chat-image-capabilities-retry]')) {
            getChatImageComposerState(state).capabilityError = null;
            render();
            return true;
        }
        if (target.closest('[data-chat-image-model-chip]')) {
            const composer = getChatImageComposerState(state);
            composer.modelChipOpen = !composer.modelChipOpen;
            render();
            return true;
        }
        if (target.closest('[data-chat-image-model-close]')) {
            closeModelPopover();
            return true;
        }
        // 点弹层外面：收起弹层，但不吞掉这次点击
        if (getChatImageComposerState(state).modelChipOpen && !target.closest('[data-chat-image-model]')) {
            closeModelPopover();
        }
        return false;
    }

    function handleInput(event) {
        const target = event.target;
        if (target instanceof HTMLTextAreaElement && target.matches('[data-chat-image-prompt]')) {
            ctx.updateChatImageDraft?.({ prompt: target.value });
            updateGenerateButton(target.value);
            fitComposerInput(target);
            return true;
        }
        if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.matches('[data-chat-image-param]')) {
            ctx.updateChatImageDraft?.({ params: { [target.dataset.chatImageParam]: target.value } });
            return true;
        }
        return false;
    }

    function handleChange(event) {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.matches('[data-chat-image-param]')) {
            const key = target.dataset.chatImageParam;
            ctx.updateChatImageDraft?.({ params: { [key]: key === 'count' ? Number(target.value) || 1 : target.value } });
            return true;
        }
        if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.matches('[data-chat-image-param], [data-chat-image-prompt]')) {
            // 已在 input 事件里记下
            return true;
        }
        return false;
    }

    function handleKeydown(event) {
        const target = event.target;
        if (target instanceof HTMLElement && target.matches('[data-chat-image-prompt]') && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (target instanceof HTMLTextAreaElement) {
                ctx.updateChatImageDraft?.({ prompt: target.value });
            }
            call('generateChatImage', '图片生成失败');
            return true;
        }
        if (event.key === 'Escape' && closeModelPopover()) {
            event.preventDefault();
            return true;
        }
        return false;
    }

    function bindSettingsButtons() {
        for (const button of document.querySelectorAll('[data-chat-image-open-settings]')) {
            if (boundSettingsButtons.has(button)) {
                continue;
            }
            boundSettingsButtons.add(button);
            button.addEventListener('click', () => {
                state.settingsConnectionView = 'image';
                getChatImageComposerState(state).modelChipOpen = false;
                try {
                    localStorage.setItem(SETTINGS_CONNECTION_VIEW_KEY, 'image');
                } catch {
                    // 记不住只影响下次打开的默认分区
                }
            });
        }
    }

    // 图片模型没配置好时不留在「从消息生成」（设置里删了密钥、换了供应商）：否则消息列表会出现勾选框而输入框只有空状态
    function leaveAutoWhenUnconfigured() {
        const view = getView();
        if (view?.mode !== 'image' || view.sub !== 'auto' || state.engine.generating) {
            return;
        }
        if (!getImageConfigReadiness(getImageGenerationConfig(state.settings), state.secretState).ok) {
            ctx.cancelChatImagePrompt?.();
            ctx.setChatImageSubMode?.('manual');
        }
    }

    function afterRender() {
        leaveAutoWhenUnconfigured();
        if (typeof ctx.recoverChatImageJob === 'function') {
            ctx.recoverChatImageJob().catch(error => console.warn('[chat-image] 找回进行中的图片任务失败', error));
        }
        bindSettingsButtons();
        const prompt = document.querySelector('[data-chat-image-prompt]');
        if (prompt instanceof HTMLTextAreaElement) {
            fitComposerInput(prompt);
            const composer = getChatImageComposerState(state);
            if (composer.focusPrompt && !prompt.disabled) {
                composer.focusPrompt = false;
                prompt.focus({ preventScroll: true });
                prompt.setSelectionRange(prompt.value.length, prompt.value.length);
            }
        }
        // 图片模式下参数标签需要能力（不计费）；钩子由 actions/chat-image-generation.js 挂上，没有缓存时读一次
        if (document.querySelector('[data-chat-image-composer]')) {
            state.chatImageGeneration?.loadCapabilities?.();
        }
    }

    return {
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
        afterRender,
    };
}

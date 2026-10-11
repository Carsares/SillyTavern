/**
 * 从消息生成的勾选模式（WP5）。
 * components/chat-message.js 通过下面两个函数接入：
 *   getMessageSelection(message, messageIndex)  返回 { className, attrs, controlHtml }：
 *       className 加在 <article class="message …"> 上，attrs 加在 article 上（如 data-image-select="身份"），
 *       controlHtml 插在消息头最前面（复选框）。不在勾选模式时三项都是空串。
 *   renderSelectionBanner()  消息列表顶部的提示条（勾选模式外返回空串）
 * components/chat-image-composer.js 在子模式为「从消息生成」时调用：
 *   renderPromptSourceSteps(view, messages)  步骤条 + 当前步骤的内容：第 1 步勾选摘要与「生成提示词」，第 2 步进度与取消，
 *       第 3 步「由 N 条消息生成 · 重新生成提示词 · 返回勾选」一行；第 3 步的提示词框和「生成图片」由 chat-image-composer.js 自己渲染。
 *
 * 勾选按消息身份（core/image-message.js 的 messageIdentity）记，事件在 routes/chat-image-prompt-events.js，动作在
 * actions/chat-image-prompt.js。
 *
 * @param {any} ctx 聊天路由上下文。
 */
import { peekChatImageView } from '../core/chat-image-state.js';
import { isImageMessage, isPromptSourceMessage, messageIdentity } from '../core/image-message.js';
import {
    describePromptSourceSelection,
    getPromptGenerationGate,
    isChatImageSelectionActive,
    isPromptGenerationSupported,
    isTextGenerationBusy,
    resolvePromptModel,
    selectPromptSources,
} from '../actions/chat-image-prompt.js';

const EMPTY_SELECTION = Object.freeze({ className: '', attrs: '', controlHtml: '' });
const QUICK_SELECT_COUNTS = [1, 3, 5];

export function createChatImageSelectionComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber = value => String(value),
        getCurrentDraftKey,
        getSelectedChatMessages,
        isGroupChatMode = () => false,
        getOaiSettings,
        getChatCompletionModel,
    } = ctx;

    /** 当前聊天处于勾选模式时返回它的图片界面状态，否则为 null。 */
    function getSelectingView() {
        const view = peekChatImageView(state, getCurrentDraftKey());
        return isChatImageSelectionActive(view, state.settings) ? view : null;
    }

    function getUnavailableReason(message) {
        if (isImageMessage(message)) {
            return '图片消息不参与生成提示词';
        }
        if (message?.is_system) {
            return '系统消息不参与生成提示词';
        }
        return '空消息不参与生成提示词';
    }

    /**
     * @param {any} message 消息。
     * @param {number} messageIndex 下标（只用于标记，勾选按身份记）。
     * @returns {{ className: string, attrs: string, controlHtml: string }}
     */
    function getMessageSelection(message, messageIndex) {
        const view = getSelectingView();
        if (!view) {
            return EMPTY_SELECTION;
        }
        if (!isPromptSourceMessage(message)) {
            return {
                className: 'message-unselectable',
                attrs: `data-image-select-unavailable title="${escapeHtml(getUnavailableReason(message))}"`,
                controlHtml: '',
            };
        }
        const identity = messageIdentity(message);
        const selected = view.selected.has(identity);
        const label = `${selected ? '取消勾选' : '勾选'}${message.name ? `「${message.name}」的` : '这条'}消息`;
        return {
            className: `message-selectable${selected ? ' message-selected' : ''}`,
            attrs: `data-image-select="${escapeHtml(identity)}" data-image-selected="${selected ? 'true' : 'false'}"`,
            controlHtml: `<input class="message-select-checkbox" type="checkbox" data-image-select-checkbox aria-label="${escapeHtml(label)}" ${selected ? 'checked' : ''}>`,
        };
    }

    function renderSelectionBanner() {
        const view = getSelectingView();
        if (!view) {
            return '';
        }
        const { count } = describePromptSourceSelection(selectPromptSources(view.selected, getSelectedChatMessages()));
        return `
                <div class="chat-image-select-banner" role="status" data-image-select-banner>
                    <i class="fa-solid fa-list-check" aria-hidden="true"></i>
                    <span>正在勾选消息：点击消息即可勾选或取消，已选 <b data-image-select-banner-count>${formatNumber(count)}</b> 条</span>
                    <button class="secondary-button compact-button" type="button" data-image-select-exit>退出勾选（Esc）</button>
                </div>`;
    }

    function getModel() {
        return resolvePromptModel({
            settings: state.settings,
            oaiSettings: typeof getOaiSettings === 'function' ? getOaiSettings() : state.settings?.oai_settings,
            getChatCompletionModel,
        }).model;
    }

    function renderStepper(step) {
        const items = ['勾选消息', '生成提示词', '确认并生成图片'].map((label, index) => {
            const number = index + 1;
            const status = number === step ? 'is-active' : (number < step ? 'is-done' : '');
            const marker = number < step ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : String(number);
            const line = index ? '<span class="chat-image-step-line" aria-hidden="true"></span>' : '';
            return `${line}<span class="chat-image-step ${status}" role="listitem" ${number === step ? 'aria-current="step"' : ''}><span class="chat-image-step-num">${marker}</span>${label}</span>`;
        });
        return `
            <div class="chat-image-stepper" role="list" aria-label="从消息生成的步骤" data-image-prompt-stepper>${items.join('')}</div>`;
    }

    function renderSelectStep(view, messages) {
        const sources = selectPromptSources(view.selected, messages);
        const summary = describePromptSourceSelection(sources);
        const gate = getPromptGenerationGate({ settings: state.settings, engine: state.engine, sources, model: getModel() });
        const error = view.promptJob && !view.promptJob.controller ? view.promptJob.error : '';
        const appearanceHint = isGroupChatMode() ? '取勾选消息里出现的角色的卡片描述' : '取角色卡描述';
        // 原型只把超限、文本生成中、没填模型写在框里；没勾选时摘要里的「已选 0 条」已经说明了
        const visibleHint = ['over-limit', 'busy', 'no-model'].includes(gate.code) ? gate.reason : '';
        return `
            <div class="chat-image-select-box" data-image-prompt-select-box>
                <div class="chat-image-select-main">
                    <div class="chat-image-select-summary" data-image-select-summary>在上方消息列表里勾选要参考的消息 · 已选 <strong data-image-select-count>${formatNumber(summary.count)}</strong> 条，约 ${formatNumber(summary.characters)} 字</div>
                    <div class="chat-image-select-tools">
                        <span>快速选择</span>
                        ${QUICK_SELECT_COUNTS.map(count => `<button class="secondary-button compact-button" type="button" data-image-select-recent="${count}">最近 ${count} 条</button>`).join('')}
                        <button class="secondary-button compact-button" type="button" data-image-select-clear ${summary.count ? '' : 'disabled'}>清空</button>
                        <label class="chat-image-switch" title="${escapeHtml(appearanceHint)}">
                            <input type="checkbox" role="switch" data-image-prompt-appearance ${view.includeAppearance ? 'checked' : ''}>
                            <span class="chat-image-switch-knob" aria-hidden="true"></span>
                            附带角色外貌（${escapeHtml(appearanceHint)}）
                        </label>
                    </div>
                    ${visibleHint ? `<p class="chat-image-select-hint" data-image-prompt-gate="${escapeHtml(gate.code)}">${escapeHtml(visibleHint)}</p>` : ''}
                    ${error ? `
                        <div class="chat-image-prompt-error" role="alert" data-image-prompt-error>
                            <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                            <span>${escapeHtml(error)}</span>
                        </div>` : ''}
                </div>
                <button class="primary-button" type="button" data-image-prompt-generate ${gate.ok ? '' : 'disabled'} ${gate.ok ? '' : `title="${escapeHtml(gate.reason)}"`}>
                    <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                    ${error ? '重试生成提示词' : '生成提示词'}
                    <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                </button>
            </div>`;
    }

    function renderGeneratingStep(view, messages) {
        const { count } = describePromptSourceSelection(selectPromptSources(view.selected, messages));
        const model = getModel();
        return `
            <div class="chat-image-prompt-progress" role="status" data-image-prompt-progress>
                <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                <span>正在用 <b>${escapeHtml(model || '文本模型')}</b> 根据 ${formatNumber(count)} 条消息${view.includeAppearance ? '和角色外貌' : ''}生成图片提示词……不会写入聊天记录。</span>
                <button class="secondary-button compact-button" type="button" data-image-prompt-cancel>
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    取消
                </button>
            </div>`;
    }

    function renderSourceLine(view) {
        const busy = isTextGenerationBusy(state.engine);
        return `
            <div class="chat-image-prompt-source" data-image-prompt-source>
                ${view.promptFrom > 0 ? `<span class="badge chat-image-prompt-source-tag" data-image-prompt-from="${view.promptFrom}"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>由 ${formatNumber(view.promptFrom)} 条消息生成</span>` : ''}
                <span>可以直接修改；确认后点「生成图片」。</span>
                <button class="secondary-button compact-button" type="button" data-image-prompt-regenerate ${busy ? 'disabled' : ''} title="${escapeHtml(busy ? '文本回复生成中，结束后才能生成提示词。' : '用同样的勾选重新生成，会覆盖提示词框里的内容')}">
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    重新生成提示词
                </button>
                <button class="secondary-button compact-button" type="button" data-image-prompt-back>
                    <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                    返回勾选
                </button>
            </div>`;
    }

    /**
     * @param {import('../core/chat-image-state.js').ChatImageView | null} view 当前聊天的图片界面状态。
     * @param {any[]} messages 当前聊天的全部消息。
     * @returns {string}
     */
    function renderPromptSourceSteps(view, messages) {
        if (!view) {
            return '';
        }
        if (!isPromptGenerationSupported(state.settings)) {
            return `
            <div class="chat-image-prompt-progress is-note" role="note" data-image-prompt-unsupported>
                <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
                <span>当前主连接是<b>文本补全</b>，第一期只支持在<b>聊天补全</b>连接上从消息生成提示词。可以切到「手动输入」自己写。</span>
            </div>`;
        }
        const step = view.autoStep === 2 || view.autoStep === 3 ? view.autoStep : 1;
        const list = Array.isArray(messages) ? messages : getSelectedChatMessages();
        const body = step === 1 ? renderSelectStep(view, list) : (step === 2 ? renderGeneratingStep(view, list) : renderSourceLine(view));
        return `
            <div class="chat-image-prompt-steps" data-image-prompt-steps data-image-prompt-step="${step}">
                ${renderStepper(step)}
                ${body}
            </div>`;
    }

    return {
        getMessageSelection,
        renderSelectionBanner,
        renderPromptSourceSteps,
    };
}

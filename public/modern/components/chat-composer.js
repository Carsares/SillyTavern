import { resolveSlotHtml } from '../core/test-flags.js';
import { isLastMessageImage } from '../core/image-message.js';
import { createChatConnectionChipComponent } from './chat-connection-chip.js';
import { createChatImageComposerComponents } from './chat-image-composer.js';
import { createChatUsageLabelComponent } from './chat-usage-label.js';

// 只在发送受阻或正在生成时显示状态行；空草稿的提示已由输入框占位符说明，不再常驻一行。
function getComposerStatusText(state, hasTarget) {
    if (!hasTarget) {
        return '先选择角色或群聊。';
    }
    if (state.engine.generating) {
        return state.engine.detail || '生成中，请等待当前回复完成。';
    }
    // 连接档案 / 模型正在切换：此刻发出的消息可能还用旧配置，等切换完成再发（components/chat-connection-chip.js）
    if (state.connectionSwitcher?.busy) {
        return `${state.connectionSwitcher.busyLabel || '正在切换连接'}，完成后再发送。`;
    }
    return '';
}

export function createChatComposerComponents(ctx) {
    const {
        state,
        escapeHtml,
        getCurrentDraft,
        getSelectedChatEntity,
    } = ctx;
    const { renderChatConnectionChip } = createChatConnectionChipComponent(ctx);
    const { renderChatUsageLabel } = createChatUsageLabelComponent(ctx);
    // 会话内生图（components/chat-image-composer.js）：元信息行最前面的「文本 / 图片」切换，图片模式下换掉文本框和按钮。
    // 这是 MODERN_UI_ARCHITECTURE.md「不改 chat-composer.js」的登记例外：图片模式必须替换输入框主体，只留这两处接入点。
    const {
        isChatImageMode,
        renderChatImageModeToggle,
        renderChatImageModelChip,
        renderChatImageComposerBody,
    } = createChatImageComposerComponents(ctx);

    function renderChatComposer(messages) {
        const draft = getCurrentDraft();
        const draftLength = draft.trim().length;
        const entity = getSelectedChatEntity();
        const hasTarget = Boolean(entity);
        const switchingConnection = Boolean(state.connectionSwitcher?.busy);
        const canSend = !state.engine.generating && !switchingConnection && hasTarget && draftLength > 0;
        const statusText = getComposerStatusText(state, hasTarget);
        const imageMode = isChatImageMode();
        // 最后一条是图片消息时不能「继续」「重生成」：旧引擎重生成会删掉最后一条非用户消息（含图片消息），继续会把文字续写进去
        const lastIsImage = isLastMessageImage(messages);
        // 输入框下方的元信息行：生图的「文本 / 图片」切换（插槽）在最前，B1 的连接标签（插槽，图片模式下换成图片模型标签）其次，
        // 上次发送的用量标签在后；都为空时不渲染这一行。用量标签只读缓存的提示词分解快照，渲染时不发请求（见 components/chat-usage-label.js）
        const connectionHtml = imageMode ? renderChatImageModelChip() : resolveSlotHtml('chatConnectionChip', renderChatConnectionChip());
        const metaHtml = `${resolveSlotHtml('chatImageModeToggle', renderChatImageModeToggle())}${connectionHtml}${renderChatUsageLabel()}`;

        // Manual group activation (strategy 2): let the user pick which enabled member speaks next
        const manualSpeakers = !state.engine.generating && entity && String(entity.activation_strategy) === '2' && Array.isArray(entity.members)
            ? entity.members.filter(avatar => !(Array.isArray(entity.disabled_members) && entity.disabled_members.includes(avatar)))
            : [];

        if (imageMode) {
            return `
        <div class="composer composer-image-mode" data-composer-image-mode>
            ${renderChatImageComposerBody(messages)}
            ${metaHtml ? `<div class="composer-meta" data-composer-meta>${metaHtml}</div>` : ''}
        </div>
    `;
        }

        return `
        <div class="composer">
            <textarea data-chat-input rows="1" ${state.engine.generating ? 'disabled' : ''} placeholder="输入消息，按 Ctrl/⌘ + Enter 发送">${escapeHtml(draft)}</textarea>
            ${statusText ? `<div class="composer-status" data-composer-status>${escapeHtml(statusText)}</div>` : ''}
            <button class="primary-button" type="button" data-send-message ${canSend ? '' : 'disabled'}>
                <i class="fa-solid ${state.engine.generating ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}"></i>
                ${state.engine.generating ? '生成中' : '发送'}
            </button>
            ${!state.engine.generating && messages.length ? `
                <button class="secondary-button" type="button" data-continue-message ${switchingConnection || lastIsImage ? 'disabled' : ''} ${lastIsImage ? 'title="最后一条是图片消息，不能继续"' : ''}>
                    <i class="fa-solid fa-forward-step"></i>
                    继续
                </button>
                <button class="secondary-button" type="button" data-regenerate-message ${switchingConnection || lastIsImage ? 'disabled' : ''} ${lastIsImage ? 'title="最后一条是图片消息，不能重生成"' : ''}>
                    <i class="fa-solid fa-rotate-right"></i>
                    重生成
                </button>
            ` : ''}
            ${state.engine.generating ? `
                <button class="secondary-button" type="button" data-stop-generation>
                    <i class="fa-solid fa-stop"></i>
                    停止
                </button>
            ` : ''}
            ${metaHtml ? `<div class="composer-meta" data-composer-meta>${metaHtml}</div>` : ''}
            ${manualSpeakers.length ? `
                <div class="composer-manual-speakers">
                    <span class="composer-manual-label">手动发言：</span>
                    ${manualSpeakers.map(avatar => {
        const character = state.characters.find(item => (item.avatar || '') === avatar);
        const name = character?.name || character?.data?.name || avatar;
        return `<button class="secondary-button compact-button" type="button" data-speak-member="${escapeHtml(avatar)}">${escapeHtml(name)}</button>`;
    }).join('')}
                </div>
            ` : ''}
        </div>
    `;
    }

    return {
        renderChatComposer,
    };
}

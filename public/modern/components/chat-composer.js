import { resolveSlotHtml } from '../core/test-flags.js';
import { createChatConnectionChipComponent } from './chat-connection-chip.js';

// 只在发送受阻或正在生成时显示状态行；空草稿的提示已由输入框占位符说明，不再常驻一行。
function getComposerStatusText(state, hasTarget) {
    if (!hasTarget) {
        return '先选择角色或群聊。';
    }
    if (state.engine.generating) {
        return state.engine.detail || '生成中，请等待当前回复完成。';
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

    function renderChatComposer(messages) {
        const draft = getCurrentDraft();
        const draftLength = draft.trim().length;
        const entity = getSelectedChatEntity();
        const hasTarget = Boolean(entity);
        const canSend = !state.engine.generating && hasTarget && draftLength > 0;
        const statusText = getComposerStatusText(state, hasTarget);
        // 输入框下方的元信息行（B1 连接标签等）；插槽返回空字符串时不渲染这一行
        const metaHtml = resolveSlotHtml('chatConnectionChip', renderChatConnectionChip());

        // Manual group activation (strategy 2): let the user pick which enabled member speaks next
        const manualSpeakers = !state.engine.generating && entity && String(entity.activation_strategy) === '2' && Array.isArray(entity.members)
            ? entity.members.filter(avatar => !(Array.isArray(entity.disabled_members) && entity.disabled_members.includes(avatar)))
            : [];

        return `
        <div class="composer">
            <textarea data-chat-input rows="1" ${state.engine.generating ? 'disabled' : ''} placeholder="输入消息，按 Ctrl/⌘ + Enter 发送">${escapeHtml(draft)}</textarea>
            ${statusText ? `<div class="composer-status" data-composer-status>${escapeHtml(statusText)}</div>` : ''}
            <button class="primary-button" type="button" data-send-message ${canSend ? '' : 'disabled'}>
                <i class="fa-solid ${state.engine.generating ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}"></i>
                ${state.engine.generating ? '生成中' : '发送'}
            </button>
            ${!state.engine.generating && messages.length ? `
                <button class="secondary-button" type="button" data-continue-message>
                    <i class="fa-solid fa-forward-step"></i>
                    继续
                </button>
                <button class="secondary-button" type="button" data-regenerate-message>
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

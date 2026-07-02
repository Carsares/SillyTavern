export function createChatComposerComponents({
    state,
    escapeHtml,
    getCurrentDraft,
    getSelectedChatEntity,
}) {
    function renderChatComposer(messages) {
        const draft = getCurrentDraft();
        const draftLength = draft.trim().length;
        const hasTarget = Boolean(getSelectedChatEntity());
        const canSend = !state.engine.generating && hasTarget && draftLength > 0;

        return `
        <div class="composer">
            <textarea data-chat-input ${state.engine.generating ? 'disabled' : ''} placeholder="输入消息，按 Ctrl/⌘ + Enter 发送">${escapeHtml(draft)}</textarea>
            <div class="composer-status" data-composer-status>${escapeHtml(getComposerStatusText(draftLength, hasTarget))}</div>
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
        </div>
    `;
    }

    function getComposerStatusText(draftLength, hasTarget) {
        if (!hasTarget) {
            return '先选择角色或群聊。';
        }
        if (state.engine.generating) {
            return state.engine.detail || '生成中，请等待当前回复完成。';
        }
        if (draftLength > 0) {
            return `${draftLength} 字，准备发送。`;
        }
        return '输入消息后可发送；空消息不会提交。';
    }

    return {
        renderChatComposer,
    };
}

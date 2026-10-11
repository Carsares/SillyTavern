// 聊天摘要（A6）面板的事件绑定，约定见 chat-tools-events.js 顶部注释。
// 输入框的改动只写进草稿（updateChatSummaryDraft），再按返回的视图就地更新未保存标记和保存按钮，不重新渲染，输入焦点因此不会丢。
// 点击类动作（保存、清除、还原、重新摘要）由 actions 完成并重新渲染。

function setHidden(element, hidden) {
    if (element) {
        element.hidden = hidden;
    }
}

// 草稿变化后，把可就地更新的部分对齐到视图：未保存标记、「聊天里摘要已变」提示、保存按钮
function syncChatSummaryDom(view) {
    if (!view?.ready) {
        return;
    }

    const root = document.querySelector('[data-chat-summary]');
    if (!root) {
        return;
    }

    setHidden(root.querySelector('[data-cs-dirty]'), !view.dirty);
    setHidden(root.querySelector('[data-cs-message="stale"]'), !view.stale);
    setHidden(root.querySelector('[data-cs-message="notice"]'), !view.notice);
    const save = /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-cs-save]'));
    if (save) {
        save.disabled = view.saving || view.generating || !view.dirty;
    }
}

export function bindChatToolSummaryEvents(ctx) {
    const {
        showToast,
        render,
        state,
        beginChatSummaryClear,
        cancelChatSummaryClear,
        confirmChatSummaryClear,
        openChatSummarySettings,
        resetChatSummaryDraft,
        runChatSummaryNow,
        saveChatSummaryEdit,
        updateChatSummaryDraft,
    } = ctx;

    const clickActions = [
        ['[data-cs-save]', saveChatSummaryEdit],
        ['[data-cs-reset]', resetChatSummaryDraft],
        ['[data-cs-clear]', beginChatSummaryClear],
        ['[data-cs-clear-cancel]', cancelChatSummaryClear],
        ['[data-cs-clear-confirm]', confirmChatSummaryClear],
        ['[data-cs-run]', runChatSummaryNow],
        ['[data-cs-open-settings]', openChatSummarySettings],
    ];

    function handleInput(event) {
        const field = event.target instanceof Element ? event.target.closest('[data-cs-input]') : null;
        if (!field) {
            return false;
        }

        syncChatSummaryDom(updateChatSummaryDraft(/** @type {HTMLTextAreaElement} */ (field).value));
        return true;
    }

    async function handleClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {
            return false;
        }

        for (const [selector, action] of clickActions) {
            const button = /** @type {HTMLButtonElement | null} */ (target.closest(selector));
            if (!button) {
                continue;
            }

            if (!button.disabled) {
                try {
                    await action();
                } catch (error) {
                    state.errors.push({ key: 'chat-summary', message: error.message });
                    showToast('聊天摘要操作失败', error.message);
                    render();
                }
            }
            return true;
        }

        return false;
    }

    return {
        handleClick,
        handleInput,
    };
}

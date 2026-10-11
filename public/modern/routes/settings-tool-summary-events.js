// 设置页「聊天工具」标签里聊天摘要设置分区（A6）的事件绑定，约定见 settings-chat-tools-events.js 顶部注释。
// 输入框 / 下拉 / 复选框的改动只写进草稿（updateSummarySettingsDraft），再按返回的视图就地更新联动，不重新渲染，输入焦点因此不会丢。
// 点击类动作（保存、还原、恢复默认提示词、切换为主模型）由 actions/chat-summary.js 完成并重新渲染。

function setHidden(element, hidden) {
    if (element) {
        element.hidden = hidden;
    }
}

// 草稿变化后，把可就地更新的部分对齐到视图：未保存标记、校验错误、深度和角色的显隐
function syncSummarySettingsDom(view) {
    const root = document.querySelector('[data-settings-summary]');
    if (!root || !view) {
        return;
    }

    setHidden(root.querySelector('[data-ss-dirty]'), !view.dirty);
    for (const error of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-ss-error]'))) {
        const message = view.errors?.[error.dataset.ssError] || '';
        error.textContent = message;
        setHidden(error, !message);
    }
    for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll('[data-ss-field]'))) {
        if (input.type !== 'checkbox') {
            input.setAttribute('aria-invalid', view.errors?.[input.dataset.ssField] ? 'true' : 'false');
        }
    }
    setHidden(root.querySelector('[data-ss-message="notice"]'), !view.notice);
    setHidden(root.querySelector('[data-ss-depth-group]'), !view.inChat);
}

export function bindSettingsToolSummaryEvents(ctx) {
    const {
        showToast,
        render,
        state,
        resetSummarySettingsDraft,
        restoreDefaultSummaryPrompt,
        saveSummarySettings,
        switchSummarySourceToMain,
        updateSummarySettingsDraft,
    } = ctx;

    const clickActions = [
        ['[data-ss-save]', saveSummarySettings],
        ['[data-ss-reset]', resetSummarySettingsDraft],
        ['[data-ss-restore-prompt]', restoreDefaultSummaryPrompt],
        ['[data-ss-switch-main]', switchSummarySourceToMain],
    ];

    // input 和 change 都走这里：同一个值写两次没有副作用，文本框、下拉、复选框各自触发哪个事件都能接住
    function applyFieldEvent(event) {
        const field = /** @type {HTMLInputElement | null} */ (event.target instanceof Element ? event.target.closest('[data-ss-field]') : null);
        if (!field) {
            return false;
        }

        const value = field.type === 'checkbox' ? (field.checked ? '1' : '') : field.value;
        syncSummarySettingsDom(updateSummarySettingsDraft(field.dataset.ssField, value));
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
                    state.errors.push({ key: 'summary-settings', message: error.message });
                    showToast('摘要设置操作失败', error.message);
                    render();
                }
            }
            return true;
        }

        return false;
    }

    return {
        handleClick,
        handleInput: applyFieldEvent,
        handleChange: applyFieldEvent,
    };
}

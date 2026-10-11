// 设置页「聊天工具」标签里聊天摘要设置分区（A6）的事件绑定，约定见 settings-chat-tools-events.js 顶部注释。
// 输入时只写进草稿（updateSummarySettingsDraft）并就地更新联动；失焦或选择（change）后校验整份草稿并保存，
// 连续改动合并执行。「恢复默认提示词」改完也立即保存；「切换为主模型」由 actions/chat-summary.js 直接保存。
import { createCoalescedRunner } from '../actions/settings-autosave.js';


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
        settingsAutosave,
        restoreDefaultSummaryPrompt,
        saveSummarySettings,
        switchSummarySourceToMain,
        updateSummarySettingsDraft,
    } = ctx;

    const saveDraft = createCoalescedRunner(async () => {
        const result = await saveSummarySettings({ quiet: true });
        // 保存不重绘时就地对齐未保存标记和字段错误
        syncSummarySettingsDom(ctx.getSummarySettingsView());
        if (result?.ok) {
            settingsAutosave.markSaved('摘要设置');
        } else if (result?.invalid) {
            settingsAutosave.markInvalid(result.error || '摘要设置有字段没有通过校验');
        } else if (result) {
            settingsAutosave.markFailed('摘要设置', result.error || '');
        }
    });

    // 点击类动作先等失焦触发的那次保存结束，否则会因为「正在保存」被忽略
    /** @type {Array<[string, () => Promise<void>]>} */
    const clickActions = [
        ['[data-ss-restore-prompt]', async () => {
            await saveDraft.idle();
            restoreDefaultSummaryPrompt();
            await saveDraft();
        }],
        ['[data-ss-switch-main]', async () => {
            await saveDraft.idle();
            await switchSummarySourceToMain();
        }],
    ];

    // 输入时只更新草稿和就地联动
    function applyFieldEvent(event) {
        const field = /** @type {HTMLInputElement | null} */ (event.target instanceof Element ? event.target.closest('[data-ss-field]') : null);
        if (!field) {
            return null;
        }

        const value = field.type === 'checkbox' ? (field.checked ? '1' : '') : field.value;
        syncSummarySettingsDom(updateSummarySettingsDraft(field.dataset.ssField, value));
        return field;
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

    function handleInput(event) {
        return Boolean(applyFieldEvent(event));
    }

    // change（失焦或选择）：先同步草稿，再保存
    async function handleChange(event) {
        if (!applyFieldEvent(event)) {
            return false;
        }
        await saveDraft();
        return true;
    }

    return {
        handleClick,
        handleInput,
        handleChange,
    };
}

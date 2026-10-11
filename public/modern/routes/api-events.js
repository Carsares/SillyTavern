// 设置中心「模型连接」标签的事件：字段改动即保存（actions/api-autosave.js），连接测试，连接档案。
// 由 routes/settings-events.js 在这个标签打开时转发；处理过返回 true。
import { refreshConnectionHints } from '../actions/api-autosave.js';
import { getSwitcherState } from '../actions/connection-profiles.js';
import { createApiProfileComponents } from '../components/api-profiles.js';

const LIVE_HINT_SELECTOR = '[data-api-model], [data-api-max-context], [data-api-max-tokens], [data-textgen-max-context], [data-textgen-amount-gen]';
const ENTER_SAVE_SELECTOR = '[data-api-connection-form] input:not([type="checkbox"]):not([type="radio"])';

export function createApiEvents(ctx) {
    const {
        state,
        render,
        showToast,
        settingsAutosave,
        testApiConnection,
        saveConnectionField,
        fillSuggestedContext,
        applyModelSuggestion,
        refreshHordeModels,
        startOpenRouterAuth,
        useOpenAiPreset,
        applyConnectionProfile,
        createProfileFromCurrentConnection,
        deleteConnectionProfile,
        suggestConnectionProfileName,
    } = ctx;
    const { renderConnectionProfilesSection } = createApiProfileComponents(ctx);

    /**
     * 只替换页面上的「连接档案」区，不重绘整页。找不到这一区时才整页重绘。
     */
    function replaceProfilesSection() {
        const host = document.querySelector('[data-connection-profiles]');
        if (!(host instanceof HTMLElement)) {
            render();
            return;
        }
        const template = document.createElement('template');
        template.innerHTML = renderConnectionProfilesSection().trim();
        const next = template.content.firstElementChild;
        if (next) {
            host.replaceWith(next);
        }
    }

    function focusProfileElement(selector) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
            element.focus();
        }
    }

    function escapeAttribute(value) {
        return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
    }

    // 「连接档案」区的点击：创建、应用、删除（二次确认在卡片里完成，不弹窗）
    async function handleProfileClick(event) {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('[data-connection-profiles]')) {
            return false;
        }
        const switcher = getSwitcherState(state);

        if (target.closest('[data-api-connection-profile-create-open]')) {
            switcher.createOpen = true;
            switcher.createName = suggestConnectionProfileName();
            switcher.error = '';
            replaceProfilesSection();
            const input = document.querySelector('[data-api-connection-create-name]');
            if (input instanceof HTMLInputElement) {
                input.focus();
                input.select();
            }
            return true;
        }

        if (target.closest('[data-api-connection-create-cancel]')) {
            switcher.createOpen = false;
            switcher.createName = '';
            switcher.error = '';
            replaceProfilesSection();
            focusProfileElement('[data-api-connection-profile-create-open]');
            return true;
        }

        const applyButton = target.closest('[data-api-connection-profile-apply]');
        if (applyButton instanceof HTMLElement) {
            const id = applyButton.dataset.apiConnectionProfileApply || '';
            // 先等刚改的字段保存完，档案在已保存的设置上应用
            await settingsAutosave.flush();
            await applyConnectionProfile(id);
            focusProfileElement(`[data-api-connection-profile-apply="${escapeAttribute(id)}"]`);
            return true;
        }

        const deleteButton = target.closest('[data-api-connection-profile-delete]');
        if (deleteButton instanceof HTMLElement) {
            switcher.deleteConfirmId = deleteButton.dataset.apiConnectionProfileDelete || '';
            replaceProfilesSection();
            focusProfileElement('[data-api-connection-profile-delete-confirm]');
            return true;
        }

        if (target.closest('[data-api-connection-profile-delete-cancel]')) {
            const id = switcher.deleteConfirmId;
            switcher.deleteConfirmId = '';
            replaceProfilesSection();
            focusProfileElement(`[data-api-connection-profile-delete="${escapeAttribute(id)}"]`);
            return true;
        }

        const confirmButton = target.closest('[data-api-connection-profile-delete-confirm]');
        if (confirmButton instanceof HTMLElement) {
            await deleteConnectionProfile(confirmButton.dataset.apiConnectionProfileDeleteConfirm || '');
            return true;
        }

        if (target.closest('[data-api-connection-result-dismiss]')) {
            switcher.lastResult = null;
            replaceProfilesSection();
            return true;
        }

        return false;
    }

    async function handleApiClick(event) {
        if (await handleProfileClick(event)) {
            return true;
        }

        if (event.target.closest('[data-test-api]')) {
            try {
                await testApiConnection();
            } catch (error) {
                state.errors.push({ key: 'api-test', message: error.message });
                showToast('连接测试失败', error.message);
                render();
            }
            return true;
        }

        const suggestionButton = event.target.closest('[data-api-model-suggestion]');
        if (suggestionButton instanceof HTMLElement) {
            await applyModelSuggestion(suggestionButton.dataset.apiModelSuggestion || '');
            return true;
        }

        const fillButton = event.target.closest('[data-api-context-fill]');
        if (fillButton instanceof HTMLElement) {
            await fillSuggestedContext(fillButton);
            return true;
        }

        if (event.target.closest('[data-horde-refresh]')) {
            try {
                await refreshHordeModels();
            } catch (error) {
                state.errors.push({ key: 'horde-models', message: error.message });
                showToast('AI Horde 模型刷新失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-openrouter-auth]')) {
            try {
                await startOpenRouterAuth();
            } catch (error) {
                state.errors.push({ key: 'openrouter-oauth', message: error.message });
                showToast('OpenRouter 授权发起失败', error.message);
                render();
            }
            return true;
        }

        return false;
    }

    async function handleApiChange(event) {
        const target = event.target;
        // 创建档案的名称框失焦后记住输入，之后只替换档案区时不会丢
        if (target instanceof HTMLInputElement && target.matches('[data-api-connection-create-name]')) {
            getSwitcherState(state).createName = target.value;
            return true;
        }

        // 选择聊天补全预设 = 应用预设：采样参数和长度一起换成预设里的值
        if (target instanceof HTMLSelectElement && target.matches('[data-api-preset]')) {
            if (target.value) {
                await settingsAutosave.runTask('预设', () => useOpenAiPreset(target.value));
            }
            render();
            return true;
        }

        return saveConnectionField(target);
    }

    // 输入时只更新说明文字（提示词预算、模型上限），真正保存在失焦（change）时
    function handleApiInput(event) {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.matches(LIVE_HINT_SELECTOR)) {
            refreshConnectionHints(state.settings || {}, target.closest('form'));
            return true;
        }
        return false;
    }

    // 文本框里按回车立即保存这一项（表单没有提交按钮）
    function handleApiKeydown(event) {
        const target = event.target;
        if (event.key !== 'Enter' || event.isComposing || !(target instanceof HTMLInputElement) || !target.matches(ENTER_SAVE_SELECTOR)) {
            return false;
        }
        event.preventDefault();
        void saveConnectionField(target);
        return true;
    }

    async function handleApiSubmit(event) {
        if (event.target instanceof HTMLFormElement && event.target.matches('[data-connection-profile-create-form]')) {
            event.preventDefault();
            const switcher = getSwitcherState(state);
            const input = event.target.querySelector('[data-api-connection-create-name]');
            if (input instanceof HTMLInputElement) {
                switcher.createName = input.value;
            }
            await settingsAutosave.flush();
            const result = await createProfileFromCurrentConnection(switcher.createName);
            if (!result?.ok) {
                replaceProfilesSection();
                focusProfileElement('[data-api-connection-create-name]');
            }
            return true;
        }

        if (event.target instanceof HTMLFormElement && event.target.matches('[data-api-connection-form]')) {
            event.preventDefault();
            return true;
        }

        return false;
    }

    return {
        handleApiClick,
        handleApiChange,
        handleApiInput,
        handleApiKeydown,
        handleApiSubmit,
    };
}

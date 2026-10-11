import { refreshChatCompletionContextUi, refreshChatCompletionFieldError } from '../actions/api-chat-completion-connection.js';
import { handleTextCompletionLimitChange } from '../actions/api-text-completion-connection.js';
import { getSwitcherState } from '../actions/connection-profiles.js';
import { createApiProfileComponents } from '../components/api-profiles.js';

export function createApiEvents(ctx) {
    const {
        state,
        render,
        showToast,
        testApiConnection,
        setApiModelSuggestion,
        saveApiConnectionFromForm,
        updateApiSourceFields,
        updateTextCompletionTypeFields,
        refreshHordeModels,
        startOpenRouterAuth,
        applyConnectionProfile,
        createProfileFromCurrentConnection,
        deleteConnectionProfile,
        suggestConnectionProfileName,
    } = ctx;
    const { renderConnectionProfilesSection } = createApiProfileComponents(ctx);

    /**
     * 只替换页面上的「连接档案」区，不重绘整页，上方连接表单里未保存的输入不会丢。找不到这一区时才整页重绘。
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

        const apiProfileButton = event.target.closest('[data-api-profile-main]');
        if (apiProfileButton) {
            state.apiMainDraft = apiProfileButton.dataset.apiProfileMain;
            render();
            // render() replaces #content and drops focus to <body>; move it onto the editor the button revealed
            /** @type {HTMLElement | null} */ (document.querySelector('[data-api-main]'))?.focus?.();
            return true;
        }

        const apiModelSuggestionButton = event.target.closest('[data-api-model-suggestion]');
        if (apiModelSuggestionButton) {
            setApiModelSuggestion(apiModelSuggestionButton.dataset.apiModelSuggestion);
            return true;
        }

        if (event.target.closest('[data-save-api-connection]')) {
            event.preventDefault();
            try {
                await saveApiConnectionFromForm();
            } catch (error) {
                state.errors.push({ key: 'api-save', message: error.message });
                showToast('连接配置保存失败', error.message);
                render();
            }
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

    function handleApiChange(event) {
        // 创建档案的名称框失焦后记住输入，之后只替换档案区时不会丢
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-api-connection-create-name]')) {
            getSwitcherState(state).createName = event.target.value;
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-main]')) {
            state.apiMainDraft = event.target.value;
            render();
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-source]')) {
            updateApiSourceFields(event.target.value);
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-textgen-type]')) {
            updateTextCompletionTypeFields(event.target.value);
            return true;
        }

        // 模型、「解锁上限」、上下文长度、Max Tokens 变化：更新上下文长度的 min / max 和「上限 N；提示词预算 …」说明，
        // 同时重新判断已显示的上下文长度 / Max Tokens 错误
        if (event.target instanceof HTMLInputElement
            && event.target.matches('[data-api-model], [data-api-max-context-unlocked], [data-api-max-context], [data-api-max-tokens]')) {
            refreshChatCompletionContextUi(event.target.closest('form'));
            return true;
        }

        // 文本补全的上下文长度 / 回复长度 / 解锁勾选：同样只更新说明文字和已显示的错误
        if (handleTextCompletionLimitChange(event.target)) {
            return true;
        }

        // 已标红的数值参数改动后同步刷新提示：改对即隐藏，仍越界则更新文案。
        if (refreshChatCompletionFieldError(event.target)) {
            return true;
        }

        return false;
    }

    async function handleApiSubmit(event) {
        if (event.target instanceof HTMLFormElement && event.target.matches('[data-connection-profile-create-form]')) {
            event.preventDefault();
            const switcher = getSwitcherState(state);
            const input = event.target.querySelector('[data-api-connection-create-name]');
            if (input instanceof HTMLInputElement) {
                switcher.createName = input.value;
            }
            const result = await createProfileFromCurrentConnection(switcher.createName);
            if (!result?.ok) {
                replaceProfilesSection();
                focusProfileElement('[data-api-connection-create-name]');
            }
            return true;
        }

        if (!(event.target instanceof HTMLFormElement) || !event.target.matches('[data-api-connection-form]')) {
            return false;
        }

        event.preventDefault();
        try {
            await saveApiConnectionFromForm();
        } catch (error) {
            state.errors.push({ key: 'api-save', message: error.message });
            showToast('连接配置保存失败', error.message);
            render();
        }
        return true;
    }

    return {
        handleApiClick,
        handleApiChange,
        handleApiSubmit,
    };
}

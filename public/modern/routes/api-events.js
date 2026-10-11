import { refreshChatCompletionContextUi, refreshChatCompletionFieldError } from '../actions/api-chat-completion-connection.js';
import { handleTextCompletionLimitChange } from '../actions/api-text-completion-connection.js';

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
    } = ctx;

    async function handleApiClick(event) {
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

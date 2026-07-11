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
            document.querySelector('[data-api-main]')?.focus?.();
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

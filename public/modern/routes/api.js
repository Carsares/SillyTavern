import { createApiComponents } from '../components/api.js';

export function createApiRoute(ctx) {
    const {
        state,
        render,
        showToast,
        testApiConnection,
        setApiModelSuggestion,
        saveApiConnectionFromForm,
        updateApiSourceFields,
    } = ctx;
    const { renderApi } = createApiComponents(ctx);

    async function handleClick(event) {
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
            return true;
        }

        const apiModelSuggestionButton = event.target.closest('[data-api-model-suggestion]');
        if (apiModelSuggestionButton) {
            setApiModelSuggestion(apiModelSuggestionButton.dataset.apiModelSuggestion);
            return true;
        }

        if (event.target.closest('[data-save-api-connection]')) {
            try {
                await saveApiConnectionFromForm();
            } catch (error) {
                state.errors.push({ key: 'api-save', message: error.message });
                showToast('连接配置保存失败', error.message);
                render();
            }
            return true;
        }


        return false;
    }

    function handleChange(event) {
        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-main]')) {
            state.apiMainDraft = event.target.value;
            render();
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-source]')) {
            updateApiSourceFields(event.target.value);
            return true;
        }

        return false;
    }

    return {
        render: renderApi,
        handleClick,
        handleChange,
    };
}

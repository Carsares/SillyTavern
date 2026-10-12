// 设置中心「模型连接」标签的事件：字段改动即保存（actions/api-autosave.js），连接测试，连接档案。
// 由 routes/settings-events.js 在这个标签打开时转发；处理过返回 true。
import { refreshConnectionHints, setConnectionFieldError } from '../actions/api-autosave.js';
import { getSwitcherState } from '../actions/connection-profiles.js';
import { createApiProfileComponents } from '../components/api-profiles.js';
import { MODEL_SERVICE_PROVIDERS } from '../../shared/model-services.js';
import { createImageModelEvents } from './image-model-events.js';

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
        getModelServiceUi,
        registerCurrentConnection,
        addModelService,
        updateModelServiceField,
        updateModelServiceKey,
        deleteModelService,
        selectChatService,
        updateTranslationScene,
        loadServiceModels,
        testModelService,
    } = ctx;
    const { renderConnectionProfilesSection } = createApiProfileComponents(ctx);
    // 「文本模型 / 图片模型」切换和图片模型表单（[data-image-model-form]）的事件，先于文本连接的处理
    const imageModelEvents = createImageModelEvents(ctx);

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

    // 「模型服务」区的点击：添加、获取模型列表、测试、删除（在卡片里二次确认）、登记当前连接
    async function handleModelServiceClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) {
            return false;
        }
        const ui = getModelServiceUi();

        if (target.closest('[data-model-service-add-open]')) {
            ui.addOpen = true;
            ui.addError = '';
            render();
            /** @type {HTMLElement | null} */ (document.querySelector('[data-new-service-provider]'))?.focus();
            return true;
        }
        if (target.closest('[data-model-service-add-cancel]')) {
            ui.addOpen = false;
            ui.addError = '';
            render();
            return true;
        }
        const modelsButton = target.closest('[data-model-service-models]');
        if (modelsButton instanceof HTMLElement) {
            await settingsAutosave.flush();
            await loadServiceModels(modelsButton.dataset.modelServiceModels || '');
            return true;
        }
        const testButton = target.closest('[data-model-service-test]');
        if (testButton instanceof HTMLElement) {
            await testModelService(testButton.dataset.modelServiceTest || '');
            return true;
        }
        const deleteButton = target.closest('[data-model-service-delete]');
        if (deleteButton instanceof HTMLElement) {
            ui.deleteConfirm = deleteButton.dataset.modelServiceDelete || '';
            render();
            /** @type {HTMLElement | null} */ (document.querySelector('[data-model-service-delete-confirm]'))?.focus();
            return true;
        }
        if (target.closest('[data-model-service-delete-cancel]')) {
            ui.deleteConfirm = '';
            render();
            return true;
        }
        const confirmButton = target.closest('[data-model-service-delete-confirm]');
        if (confirmButton instanceof HTMLElement) {
            ui.deleteConfirm = '';
            const result = await deleteModelService(confirmButton.dataset.modelServiceDeleteConfirm || '');
            if (!result.ok) {
                showToast('模型服务没有删除', result.error || '');
            }
            render();
            return true;
        }
        if (target.closest('[data-model-service-register-current]')) {
            await settingsAutosave.flush();
            const result = await registerCurrentConnection();
            if (!result.ok) {
                showToast('没有登记成功', result.error || '');
            }
            return true;
        }
        return false;
    }

    // 添加表单：读取各字段后新增服务
    async function submitAddServiceForm(form) {
        const read = selector => {
            const element = form.querySelector(selector);
            return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : '';
        };
        const ui = getModelServiceUi();
        const result = await addModelService({
            provider: read('[data-new-service-provider]'),
            name: read('[data-new-service-name]'),
            baseUrl: read('[data-new-service-base-url]'),
            apiKey: read('[data-new-service-key]'),
            defaultModel: read('[data-new-service-model]'),
        });
        if (!result.ok) {
            ui.addError = result.error || '模型服务没有添加成功。';
            render();
            return;
        }
        ui.addOpen = false;
        ui.addError = '';
        ui.addProvider = '';
        render();
        if (result.id) {
            void loadServiceModels(result.id);
        }
    }

    // 服务卡片和场景里的字段改动：每个字段单独保存
    async function handleModelServiceChange(target) {
        if (target instanceof HTMLSelectElement && target.matches('[data-new-service-provider]')) {
            // 只切换地址框的显示，不保存；表单其余输入保持不变
            const ui = getModelServiceUi();
            ui.addProvider = target.value;
            const field = document.querySelector('[data-new-service-base-url-field]');
            if (field instanceof HTMLElement) {
                field.hidden = !MODEL_SERVICE_PROVIDERS[target.value]?.requiresBaseUrl;
            }
            return true;
        }
        if (target instanceof HTMLInputElement && target.matches('[data-service-field][data-service-id]')) {
            const field = /** @type {'name' | 'baseUrl' | 'defaultModel'} */ (target.dataset.serviceField);
            const result = await updateModelServiceField(target.dataset.serviceId || '', field, target.value);
            setConnectionFieldError(target, `service-${field}`, result.ok ? '' : (result.error || ''));
            if (result.ok) {
                target.defaultValue = target.value;
                if (field !== 'defaultModel') {
                    render();
                }
            } else {
                settingsAutosave.markInvalid(result.error || '');
            }
            return true;
        }
        if (target instanceof HTMLInputElement && target.matches('[data-service-key][data-service-id]')) {
            if (!target.value.trim()) {
                return true;
            }
            const result = await updateModelServiceKey(target.dataset.serviceId || '', target.value);
            target.value = '';
            if (!result.ok && result.error) {
                showToast('API Key 没有保存', result.error);
            }
            render();
            return true;
        }
        if (target instanceof HTMLSelectElement && target.matches('[data-scene-chat-service]')) {
            await settingsAutosave.flush();
            await selectChatService(target.value);
            return true;
        }
        const translationField = target instanceof HTMLInputElement || target instanceof HTMLSelectElement
            ? (target.matches('[data-scene-translation-service]') ? 'serviceId'
                : target.matches('[data-scene-translation-model]') ? 'model'
                    : target.matches('[data-scene-translation-max-tokens]') ? 'maxOutputTokens' : '')
            : '';
        if (translationField) {
            const result = await updateTranslationScene(/** @type {'serviceId' | 'model' | 'maxOutputTokens'} */ (translationField), target.value);
            setConnectionFieldError(target, `scene-translation-${translationField}`, result.ok ? '' : (result.error || ''));
            if (!result.ok) {
                settingsAutosave.markInvalid(result.error || '');
            } else if (target instanceof HTMLInputElement) {
                target.defaultValue = target.value;
            }
            return true;
        }
        return false;
    }

    async function handleApiClick(event) {
        if (imageModelEvents.owns(event) && await imageModelEvents.handleClick(event)) {
            return true;
        }
        if (await handleProfileClick(event)) {
            return true;
        }
        if (await handleModelServiceClick(event)) {
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
        if (imageModelEvents.owns(event) && await imageModelEvents.handleChange(event)) {
            return true;
        }
        // 创建档案的名称框失焦后记住输入，之后只替换档案区时不会丢
        if (target instanceof HTMLInputElement && target.matches('[data-api-connection-create-name]')) {
            getSwitcherState(state).createName = target.value;
            return true;
        }

        if (await handleModelServiceChange(target)) {
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

    // 文本框里按回车立即保存这一项（表单没有提交按钮）；服务卡片和场景的输入框按回车等于离开输入框
    function handleApiKeydown(event) {
        const target = event.target;
        if (imageModelEvents.handleKeydown(event)) {
            return true;
        }
        if (event.key === 'Enter' && !event.isComposing && target instanceof HTMLInputElement
            && target.matches('[data-service-field], [data-service-key], [data-scene-translation-model], [data-scene-translation-max-tokens]')) {
            event.preventDefault();
            target.blur();
            return true;
        }
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

        if (event.target instanceof HTMLFormElement && event.target.matches('[data-model-service-add-form]')) {
            event.preventDefault();
            await submitAddServiceForm(event.target);
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

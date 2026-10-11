// 设置中心「模型连接」→「图片模型」（WP1）的事件，以及「文本模型 / 图片模型」切换。
// 由 routes/api-events.js 在「模型连接」标签打开时先转发到这里；处理过返回 true，keydown 没处理时必须返回 false
// （shell/events.js 对 keydown 的返回值不是 false 就不再走全局快捷键）。
//
// 字段都在 [data-image-model-form] 里，用 data-image-model-field 标明字段名；改动（失焦或选择）后单独校验、单独保存
// （actions/image-model-settings.js 的 saveImageModelField）。校验不通过时在字段下显示原因、不保存；保存失败时控件退回原值。
const FORM_SELECTOR = '[data-image-model-form]';
const FIELD_SELECTOR = '[data-image-model-form] [data-image-model-field]';
const KEY_SELECTOR = '[data-image-model-form] input[data-image-model-key]';
const ENTER_BLUR_SELECTOR = '[data-image-model-form] input[data-image-model-field]:not([type="checkbox"]), [data-image-model-form] input[data-image-model-key]';

/**
 * @param {Event} event 事件
 * @param {string} selector 选择器
 * @returns {HTMLElement | null} 命中的元素
 */
function closest(event, selector) {
    const target = event.target;
    const element = target instanceof Element ? target.closest(selector) : null;
    return element instanceof HTMLElement ? element : null;
}

/**
 * @param {EventTarget | null} target 事件目标
 * @returns {target is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} 是否为表单控件
 */
function isControl(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

/**
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control 控件
 * @returns {unknown} 复选框为布尔值，其余为文字
 */
function readControlValue(control) {
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        return control.checked;
    }
    return control.value;
}

/**
 * 保存成功后把控件的「初始值」对齐到当前值，之后整页重绘时它不再算作未提交的输入（见 core/preserve-inputs.js）。
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control 控件
 */
function markControlClean(control) {
    if (control instanceof HTMLSelectElement) {
        for (const option of control.options) {
            option.defaultSelected = option.selected;
        }
        return;
    }
    if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) {
        control.defaultChecked = control.checked;
        return;
    }
    control.defaultValue = control.value;
}

/**
 * 保存失败后把控件退回渲染时的值。
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control 控件
 */
function revertControl(control) {
    if (control instanceof HTMLSelectElement) {
        for (const option of control.options) {
            option.selected = option.defaultSelected;
        }
        return;
    }
    if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) {
        control.checked = control.defaultChecked;
        return;
    }
    control.value = control.defaultValue;
}

/**
 * 字段下方的报错；message 为空时去掉。
 * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control 控件
 * @param {string} field 字段名
 * @param {string} message 原因
 */
function setFieldError(control, field, message) {
    const host = control.closest('.field-label') || control.parentElement;
    const errorId = `image-model-field-error-${field}`;
    let errorElement = host?.querySelector(`[data-image-model-field-error="${field}"]`);
    if (!message) {
        control.removeAttribute('aria-invalid');
        if (control.getAttribute('aria-describedby') === errorId) {
            control.removeAttribute('aria-describedby');
        }
        errorElement?.remove();
        return;
    }
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', errorId);
    if (!errorElement) {
        errorElement = control.ownerDocument.createElement('span');
        errorElement.className = 'field-error';
        errorElement.id = errorId;
        errorElement.setAttribute('role', 'alert');
        errorElement.setAttribute('data-image-model-field-error', field);
        host?.append(errorElement);
    }
    errorElement.textContent = message;
}

/**
 * @param {any} ctx 路由上下文（含 actions/image-model-settings.js 并入的动作）
 * @returns {{ owns: (event: Event) => boolean, handleClick: (event: Event) => Promise<boolean>, handleChange: (event: Event) => Promise<boolean>, handleKeydown: (event: KeyboardEvent) => boolean }}
 */
export function createImageModelEvents(ctx) {
    const {
        state,
        render,
        showToast,
        setSettingsConnectionView,
        saveImageModelField,
        saveImageModelSecret,
        clearImageModelSecret,
        checkImageModelConfig,
        runImageModelTest,
        cancelImageModelTest,
    } = ctx;

    // 动作抛出的错误（请求失败、自动保存没准备好）统一用提示告知，不让它变成未处理的异常
    async function run(title, action) {
        try {
            return await action();
        } catch (error) {
            state.errors.push({ key: 'image-model-settings', message: error.message });
            showToast(title, error.message);
            render();
            return null;
        }
    }

    // 还有填错没保存的字段：试生成用的是已保存的配置，和页面上看到的不一样
    function getPendingFieldError() {
        return document.querySelector(`${FORM_SELECTOR} [data-image-model-field-error]`)?.textContent?.trim() || '';
    }

    /**
     * @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control 带 data-image-model-field 的控件
     * @returns {Promise<boolean>} 是否处理了
     */
    async function saveControl(control) {
        const field = control.dataset.imageModelField || '';
        const result = await run('图片模型设置保存失败', () => saveImageModelField(field, readControlValue(control)));
        if (!result) {
            revertControl(control);
            return true;
        }
        if (!result.handled) {
            return false;
        }
        if (result.invalid) {
            setFieldError(control, field, result.error || '');
            return true;
        }
        setFieldError(control, field, '');
        if (!result.ok) {
            // 设置已回滚到改动前：控件也退回渲染时的值，再重绘（否则重绘会把没保存成功的输入当成未提交的内容留下）
            revertControl(control);
            render();
            return true;
        }
        markControlClean(control);
        render();
        return true;
    }

    async function handleClick(event) {
        const viewButton = closest(event, '[data-settings-connection-view]');
        if (viewButton) {
            const view = viewButton.dataset.settingsConnectionView === 'image' ? 'image' : 'text';
            if (view !== state.settingsConnectionView) {
                setSettingsConnectionView(view);
                render();
            }
            return true;
        }

        if (!closest(event, FORM_SELECTOR)) {
            return false;
        }

        const suggestion = closest(event, '[data-image-model-suggestion]');
        if (suggestion) {
            const input = document.querySelector(`${FORM_SELECTOR} [data-image-model-field="model"]`);
            if (input instanceof HTMLInputElement) {
                input.value = suggestion.dataset.imageModelSuggestion || '';
                await saveControl(input);
            }
            return true;
        }

        if (closest(event, '[data-image-model-check]')) {
            await run('检查配置失败', () => checkImageModelConfig());
            return true;
        }

        if (closest(event, '[data-image-model-test-cancel]')) {
            cancelImageModelTest();
            return true;
        }

        if (closest(event, '[data-image-model-test]')) {
            const pending = getPendingFieldError();
            if (pending) {
                showToast('有字段没有保存', pending);
                return true;
            }
            await run('试生成失败', () => runImageModelTest());
            return true;
        }

        if (closest(event, '[data-image-model-clear-key]')) {
            await run('清除图片模型 API Key 失败', () => clearImageModelSecret());
            return true;
        }

        return false;
    }

    async function handleChange(event) {
        const target = event.target;
        if (!isControl(target)) {
            return false;
        }

        if (target instanceof HTMLInputElement && target.matches(KEY_SELECTOR)) {
            if (!target.value.trim()) {
                return true;
            }
            const result = await run('图片模型 API Key 保存失败', () => saveImageModelSecret(target.value));
            if (result?.ok) {
                // 明文不留在页面上
                target.value = '';
                markControlClean(target);
                render();
            }
            return true;
        }

        if (target.matches(FIELD_SELECTOR)) {
            return saveControl(target);
        }
        return false;
    }

    // 文本框里按回车 = 离开输入框：失焦触发 change 后保存（多行文本框里回车照常换行）
    function handleKeydown(event) {
        const target = event.target;
        if (event.key !== 'Enter' || event.isComposing || !(target instanceof HTMLInputElement) || !target.matches(ENTER_BLUR_SELECTOR)) {
            return false;
        }
        event.preventDefault();
        target.blur();
        return true;
    }

    /**
     * 事件是否来自「文本 / 图片」切换或图片模型表单。不是的事件不必经过这里的异步处理：文本连接的回车保存和失焦保存
     * 依赖 change 事件同步走到 saveConnectionField，多等一轮会让同一个密钥写两次。
     * @param {Event} event 事件
     * @returns {boolean}
     */
    function owns(event) {
        const target = event.target;
        return target instanceof Element && Boolean(target.closest('[data-image-model-form], [data-settings-connection-view]'));
    }

    return {
        owns,
        handleClick,
        handleChange,
        handleKeydown,
    };
}

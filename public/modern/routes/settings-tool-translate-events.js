// 设置页「聊天工具」标签里翻译设置分区（B3）的事件绑定，别的功能不要改这个文件。
// 返回的处理函数约定见 settings-chat-tools-events.js 顶部注释；事件在设置页任何标签下都会转发，所以都用 data- 属性判断。
//
// 改动即保存：服务、目标语言、DeepL 接口、密钥和地址任一项改动（失焦或选择）后，读取整张表单保存一次。
// 连续改动合并执行，保证最后一次改动一定会保存。「清除」按钮删除对应的已保存密钥。
import { createCoalescedRunner } from '../actions/settings-autosave.js';
import { renderTranslateTestResult } from '../components/settings-tool-translate.js';
import { describeTranslatePrivacy, getTranslateProvider } from '../core/translation.js';

const AUTOSAVE_SELECTOR = '[data-translate-provider], [data-translate-target-language], [data-translate-deepl-endpoint], input[data-translate-secret]';

function closest(event, selector) {
    return event.target instanceof Element ? event.target.closest(selector) : null;
}

/**
 * 读出表单。服务地址只在改动后才提交（避免每次保存都往密钥库追加一条相同的记录），清空表示删除；
 * API Key 留空表示不改，勾选「清除」才删除。
 * @param {Element} root 翻译设置分区
 * @returns {{ provider: string, target_language: string, deepl_endpoint: string, secrets: Record<string, string>, clear: string[] }} 表单取值
 */
export function readTranslateSettingsForm(root) {
    const read = selector => {
        const element = root.querySelector(selector);
        return element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.value : '';
    };

    /** @type {Record<string, string>} */
    const secrets = {};
    /** @type {string[]} */
    const clear = [];
    root.querySelectorAll('input[data-translate-secret]').forEach(input => {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        const key = input.dataset.translateSecret;
        const value = input.value.trim();
        if (input.hasAttribute('data-translate-url')) {
            if (value !== (input.dataset.translateOriginal || '')) {
                if (value) {
                    secrets[key] = value;
                } else {
                    clear.push(key);
                }
            }
            return;
        }
        if (value) {
            secrets[key] = value;
        }
    });
    root.querySelectorAll('input[data-translate-clear-secret]').forEach(checkbox => {
        if (checkbox instanceof HTMLInputElement && checkbox.checked && !secrets[checkbox.dataset.translateClearSecret]) {
            clear.push(checkbox.dataset.translateClearSecret);
        }
    });

    return {
        provider: read('[data-translate-provider]'),
        target_language: read('[data-translate-target-language]'),
        deepl_endpoint: read('[data-translate-deepl-endpoint]') || 'free',
        secrets,
        clear,
    };
}

/**
 * @param {any} ctx 路由上下文。
 * @returns {{
 *   handleClick?: (event: Event) => any,
 *   handleChange?: (event: Event) => any,
 *   handleKeydown?: (event: KeyboardEvent) => boolean,
 * }} 可选的事件处理函数
 */
export function bindSettingsToolTranslateEvents(ctx) {
    const { state, render, showToast, escapeHtml, settingsAutosave } = ctx;
    /** @type {Set<string>} */
    const pendingClear = new Set();

    // 每次都读当前页面上的表单（保存后页面会重绘），把等着删除的密钥一起交给保存动作
    const saveTranslateForm = createCoalescedRunner(async () => {
        const root = document.querySelector('[data-translate-settings]');
        if (!root) {
            return;
        }
        const values = readTranslateSettingsForm(root);
        values.clear = [...new Set([...values.clear, ...pendingClear])];
        pendingClear.clear();
        await settingsAutosave.runTask('翻译设置', () => ctx.saveTranslateSettings(values, { quiet: true }));
    });

    // 动作抛出的错误（请求失败）统一用提示告知，不让它变成未处理的异常
    async function run(title, action) {
        try {
            await action();
        } catch (error) {
            state.errors.push({ key: 'translate-settings', message: error.message });
            showToast(title, error.message);
            render();
        }
        return true;
    }

    // 测试只刷新结果块和测试按钮，不重绘整页
    function refreshTestResult() {
        const test = state.chatTranslation?.settingsTest;
        const result = document.querySelector('[data-translate-test-result]');
        if (result) {
            result.outerHTML = renderTranslateTestResult(test, escapeHtml);
        }
        const button = document.querySelector('[data-translate-test]');
        if (button instanceof HTMLButtonElement) {
            button.disabled = Boolean(test?.running);
        }
    }

    // 切换翻译服务时先就地显示 / 隐藏对应的密钥和地址行，保存完成后页面会按新服务重绘
    function showProviderRows(root, providerId) {
        const provider = getTranslateProvider(providerId);
        if (!provider) {
            return;
        }
        root.querySelectorAll('[data-translate-for]').forEach(row => {
            /** @type {HTMLElement} */ (row).hidden = /** @type {HTMLElement} */ (row).dataset.translateFor !== provider.id;
        });
        const description = root.querySelector('[data-translate-provider-description]');
        if (description) {
            description.textContent = provider.description;
        }
        const urlConfigured = Boolean(provider.urlSecret && state.secretState?.[provider.urlSecret]?.length);
        const privacy = root.querySelector('[data-translate-privacy-current]');
        if (privacy) {
            privacy.textContent = describeTranslatePrivacy(provider, urlConfigured);
        }
    }

    async function handleClick(event) {
        const clearButton = closest(event, '[data-translate-clear-secret]');
        if (clearButton instanceof HTMLElement) {
            pendingClear.add(clearButton.dataset.translateClearSecret || '');
            await saveTranslateForm();
            return true;
        }

        if (closest(event, '[data-translate-disable-auto-mode]')) {
            return run('关闭自动翻译失败', () => ctx.disableTranslateAutoMode());
        }

        if (closest(event, '[data-translate-test]')) {
            // 测试用已保存的设置：先等刚改的字段保存完
            await settingsAutosave.flush();
            return run('测试翻译失败', () => ctx.testTranslateProvider({ refresh: refreshTestResult }));
        }

        return false;
    }

    async function handleChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement) || !target.matches(AUTOSAVE_SELECTOR)) {
            return false;
        }
        const root = target.closest('[data-translate-settings]');
        if (!root) {
            return false;
        }
        if (target.matches('[data-translate-provider]')) {
            showProviderRows(root, target.value);
        }
        await saveTranslateForm();
        return true;
    }

    // 密钥和地址框里按回车 = 离开输入框：失焦触发 change 后保存；保存后的重绘会清空不再有焦点的密钥框，
    // 不会把明文留在框里、下一次保存时再写一遍
    function handleKeydown(event) {
        const target = event.target;
        if (event.key !== 'Enter' || event.isComposing || !(target instanceof HTMLInputElement) || !target.matches('input[data-translate-secret]')) {
            return false;
        }
        event.preventDefault();
        target.blur();
        return true;
    }

    return {
        handleClick,
        handleChange,
        handleKeydown,
    };
}

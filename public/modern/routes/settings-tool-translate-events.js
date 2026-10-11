// 设置页「聊天工具」标签里翻译设置分区（B3）的事件绑定，别的功能不要改这个文件。
// 返回的处理函数约定见 settings-chat-tools-events.js 顶部注释；事件在设置页任何标签下都会转发，所以都用 data- 属性判断。
//
// 表单是未受控的输入框：点「保存翻译设置」时才读取取值。切换翻译服务只显示 / 隐藏对应的密钥和地址行，
// 不重绘页面，所以已经输入还没保存的内容不会丢。
import { renderTranslateTestResult } from '../components/settings-tool-translate.js';
import { describeTranslatePrivacy, getTranslateProvider } from '../core/translation.js';

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
 * }} 可选的事件处理函数
 */
export function bindSettingsToolTranslateEvents(ctx) {
    const { state, render, showToast, escapeHtml } = ctx;

    // 动作抛出的错误（校验不通过、请求失败）统一用提示告知，不让它变成未处理的异常
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

    function handleClick(event) {
        if (closest(event, '[data-translate-save]')) {
            const root = closest(event, '[data-translate-settings]');
            if (!root) {
                return false;
            }
            return run('翻译设置保存失败', () => ctx.saveTranslateSettings(readTranslateSettingsForm(root)));
        }

        if (closest(event, '[data-translate-disable-auto-mode]')) {
            return run('关闭自动翻译失败', () => ctx.disableTranslateAutoMode());
        }

        if (closest(event, '[data-translate-test]')) {
            return run('测试翻译失败', () => ctx.testTranslateProvider({ refresh: refreshTestResult }));
        }

        return false;
    }

    function handleChange(event) {
        if (!(event.target instanceof HTMLSelectElement) || !event.target.matches('[data-translate-provider]')) {
            return false;
        }

        const root = event.target.closest('[data-translate-settings]');
        const provider = getTranslateProvider(event.target.value);
        if (!root || !provider) {
            return true;
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
        return true;
    }

    return {
        handleClick,
        handleChange,
    };
}

// 设置页「聊天工具」标签里的翻译设置分区（B3）。别的功能不要改这个文件。
// render() 返回一个完整的 <section class="form-section">；事件在 routes/settings-tool-translate-events.js，
// 业务动作（保存、关闭自动翻译、测试）在 actions/chat-translation.js，通过 shell/feature-slot-actions.js 并入路由上下文。
//
// 存储：服务、目标语言、DeepL 接口、内部语言、自动模式都在 settings.extension_settings.translate（与旧版翻译扩展共用，
// 保存后 reloadSettings 会同步给隐藏引擎）；API Key 和服务地址在密钥库（/api/secrets/write）。
// 内部语言和自动模式在这里只读：一期只做手动显示翻译，自动翻译由旧版扩展在引擎里执行，界面只提供「关闭自动翻译」。
import {
    AUTO_MODE_LABELS,
    TRANSLATE_LANGUAGES,
    TRANSLATE_PROVIDERS,
    describeTranslatePrivacy,
    getLanguageLabel,
    getTranslateProvider,
    resolveTranslateSettings,
} from '../core/translation.js';

const COMMON_LANGUAGE_CODES = Object.freeze(['zh-CN', 'zh-TW', 'en', 'ja', 'ko']);

/**
 * 「测试翻译」的结果块；测试按钮点击后直接替换这个节点，不重绘整个设置页（免得丢掉还没保存的输入）。
 * @param {{ running?: boolean, result?: string, error?: string }} test state.chatTranslation.settingsTest
 * @param {(value: unknown) => string} escapeHtml 转义函数
 * @returns {string} HTML
 */
export function renderTranslateTestResult(test, escapeHtml) {
    let body = '<span class="panel-subtitle">用已保存的设置翻译一句 "Hello, world!"，检查服务连得通。</span>';
    let state = 'idle';
    if (test?.running) {
        state = 'running';
        body = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> <span>正在测试…</span>';
    } else if (test?.error) {
        state = 'error';
        body = `<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> <span>${escapeHtml(test.error)}</span>`;
    } else if (test?.result) {
        state = 'ok';
        body = `<i class="fa-solid fa-circle-check" aria-hidden="true"></i> <span>测试成功：Hello, world! → ${escapeHtml(test.result)}</span>`;
    }
    return `<div class="translate-test-result is-${state}" role="status" data-translate-test-result data-translate-test-state="${state}">${body}</div>`;
}

// 五项设置全是翻译扩展的出厂值：多半是从没改过，而不是有意把目标语言设成英语
function looksLikeFactoryDefaults(settings) {
    return settings.configured
        && settings.provider === 'google'
        && settings.target_language === 'en'
        && settings.internal_language === 'en'
        && settings.auto_mode === 'none'
        && settings.deepl_endpoint === 'free';
}

export function createSettingsToolTranslate(ctx) {
    const { state, escapeHtml } = ctx;

    function getActiveSecret(secretKey) {
        const entries = state.secretState?.[secretKey];
        return Array.isArray(entries) ? (entries.find(entry => entry?.active) || entries[0] || null) : null;
    }

    function renderLanguageOptions(selected) {
        const option = code => `<option value="${escapeHtml(code)}" ${code === selected ? 'selected' : ''}>${escapeHtml(getLanguageLabel(code))}</option>`;
        const rest = TRANSLATE_LANGUAGES
            .filter(language => !COMMON_LANGUAGE_CODES.includes(language.code))
            .sort((first, second) => first.name.localeCompare(second.name));
        return `
            <optgroup label="常用">${COMMON_LANGUAGE_CODES.map(option).join('')}</optgroup>
            <optgroup label="全部语言">${rest.map(language => option(language.code)).join('')}</optgroup>`;
    }

    // API Key 不回显（密码框，粘贴后失焦即保存，点「清除」删除已保存的值）；服务地址不是机密，后端也不打码，所以直接填进输入框
    function renderSecretRow(provider, kind, selectedProvider) {
        const secretKey = kind === 'key' ? provider.keySecret : provider.urlSecret;
        const active = getActiveSecret(secretKey);
        const hidden = provider.id === selectedProvider ? '' : 'hidden';
        const required = kind === 'key' ? provider.keyRequired : provider.urlRequired;
        const title = kind === 'key'
            ? `${provider.label} API Key${required ? '' : '（可选）'}`
            : `${provider.label} 服务地址${required ? '' : provider.defaultUrl ? `（留空使用 ${provider.defaultUrl}）` : '（可选）'}`;
        const requiredMark = required ? '<span class="required-marker">必填</span>' : '';

        if (kind === 'key') {
            return `
            <div class="translate-secret-row" data-translate-for="${escapeHtml(provider.id)}" ${hidden}>
                <label class="field-label">
                    <span>${escapeHtml(title)}${requiredMark}</span>
                    <input class="text-input" type="password" autocomplete="off" data-translate-secret="${escapeHtml(secretKey)}" placeholder="${active ? '已保存；粘贴新密钥会替换' : '粘贴后离开输入框即保存'}">
                </label>
                <div class="translate-secret-status">
                    <span class="translate-secret-state ${active ? 'is-saved' : ''}" data-translate-secret-state="${escapeHtml(secretKey)}">${active ? `已保存（${escapeHtml(active.value)}）` : '未设置'}</span>
                    ${active ? `<button class="secondary-button compact-button" type="button" data-translate-clear-secret="${escapeHtml(secretKey)}"><i class="fa-solid fa-eraser" aria-hidden="true"></i>清除</button>` : ''}
                </div>
            </div>`;
        }

        const original = active ? String(active.value ?? '') : '';
        return `
            <div class="translate-secret-row" data-translate-for="${escapeHtml(provider.id)}" ${hidden}>
                <label class="field-label">
                    <span>${escapeHtml(title)}${requiredMark}</span>
                    <input class="text-input" type="text" autocomplete="off" spellcheck="false" data-translate-secret="${escapeHtml(secretKey)}" data-translate-url data-translate-original="${escapeHtml(original)}" value="${escapeHtml(original)}" placeholder="${escapeHtml(provider.defaultUrl || 'https://')}">
                </label>
                <div class="translate-secret-status">
                    <span class="translate-secret-state ${active ? 'is-saved' : ''}" data-translate-secret-state="${escapeHtml(secretKey)}">${active ? '已保存' : '未设置'}</span>
                </div>
            </div>`;
    }

    function renderAutoMode(settings) {
        const label = AUTO_MODE_LABELS[settings.auto_mode] || settings.auto_mode;
        if (settings.auto_mode === 'none') {
            return `
            <div class="translate-auto-mode" data-translate-auto-mode="none">
                <div>
                    <strong>自动翻译（沿用的扩展设置）：${escapeHtml(label)}</strong>
                    <p class="panel-subtitle">Modern 只提供手动翻译：在消息的操作栏点翻译按钮，或在角色编辑区翻译角色卡。</p>
                </div>
            </div>`;
        }

        const effect = settings.auto_mode === 'responses'
            ? '每条新回复生成后会自动调用翻译服务，把译文写进消息。'
            : settings.auto_mode === 'inputs'
                ? `你发送的消息可能先被翻译成内部语言（${getLanguageLabel(settings.internal_language)}）再发给模型，消息内容会被改写。`
                : `每条新回复会自动翻译，你发送的消息也可能先被翻译成内部语言（${getLanguageLabel(settings.internal_language)}）再发给模型，消息内容会被改写。`;
        const saving = Boolean(state.chatTranslation?.settingsSaving);
        return `
            <div class="translate-auto-mode is-active" role="alert" data-translate-auto-mode="${escapeHtml(settings.auto_mode)}">
                <div>
                    <strong><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> 自动翻译（沿用的扩展设置）：${escapeHtml(label)}</strong>
                    <p class="panel-subtitle">翻译扩展的这个设置仍作用于生成引擎，会按这个模式运行：${escapeHtml(effect)}Modern 一期只做手动显示翻译，建议关闭；这里不提供其他自动模式。</p>
                </div>
                <button class="secondary-button" type="button" data-translate-disable-auto-mode ${saving ? 'disabled' : ''}>
                    <i class="fa-solid fa-ban"></i>
                    关闭自动翻译
                </button>
            </div>`;
    }

    function render() {
        const settings = resolveTranslateSettings(state.settings);
        const provider = getTranslateProvider(settings.provider);
        const ui = state.chatTranslation || {};
        const saving = Boolean(ui.settingsSaving);
        const testing = Boolean(ui.settingsTest?.running);
        const hasUrl = provider?.urlSecret ? Boolean(getActiveSecret(provider.urlSecret)) : false;

        return `
        <section class="form-section translate-settings" data-translate-settings>
            <div>
                <h3 class="form-section-title">翻译</h3>
                <p class="panel-subtitle">给聊天消息和角色卡提供手动翻译：译文只用于显示，原文不会被改动。</p>
            </div>
            <div class="translate-privacy" role="note" data-translate-privacy>
                <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                <div>
                    <strong>隐私提示</strong>
                    <p>翻译会把消息或角色卡的文字发送给所选的翻译服务。Google、Bing、Yandex、DeepL 和 Lingva 公共实例是第三方公网服务，文字会离开你的电脑；LibreTranslate、DeepLX、OneRingTranslator 发送到你填写的地址。</p>
                    <p data-translate-privacy-current>${escapeHtml(provider ? describeTranslatePrivacy(provider, hasUrl) : '')}</p>
                </div>
            </div>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>翻译服务</span>
                    <select class="select-input" data-translate-provider>
                        ${TRANSLATE_PROVIDERS.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === settings.provider ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="field-label">
                    <span>目标语言</span>
                    <select class="select-input" data-translate-target-language>
                        ${renderLanguageOptions(settings.target_language)}
                    </select>
                </label>
            </div>
            ${looksLikeFactoryDefaults(settings) ? '<p class="panel-subtitle translate-default-hint" data-translate-default-hint><i class="fa-solid fa-circle-info" aria-hidden="true"></i> 目标语言还是翻译扩展的出厂值（英语）。要把消息和角色卡翻译成中文，选「简体中文」即可。</p>' : ''}
            <p class="panel-subtitle" data-translate-provider-description>${escapeHtml(provider?.description || '')}</p>
            <div class="translate-secret-grid">
                <div class="translate-secret-row" data-translate-for="deepl" ${settings.provider === 'deepl' ? '' : 'hidden'}>
                    <label class="field-label">
                        <span>DeepL 接口</span>
                        <select class="select-input" data-translate-deepl-endpoint>
                            <option value="free" ${settings.deepl_endpoint === 'free' ? 'selected' : ''}>免费版（api-free.deepl.com）</option>
                            <option value="pro" ${settings.deepl_endpoint === 'pro' ? 'selected' : ''}>Pro 版（api.deepl.com）</option>
                        </select>
                    </label>
                </div>
                ${TRANSLATE_PROVIDERS.map(item => `${item.keySecret ? renderSecretRow(item, 'key', settings.provider) : ''}${item.urlSecret ? renderSecretRow(item, 'url', settings.provider) : ''}`).join('')}
            </div>
            <div class="translate-readonly" data-translate-internal-language>
                <strong>内部语言（只读）：${escapeHtml(getLanguageLabel(settings.internal_language))}</strong>
                <p class="panel-subtitle">沿用的扩展设置，用于「翻译输入」和 OneRingTranslator 的源语言；Modern 的手动翻译只用目标语言，不使用它。</p>
            </div>
            ${renderAutoMode(settings)}
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-translate-test ${testing || saving ? 'disabled' : ''}>
                    <i class="fa-solid fa-vial"></i>
                    测试翻译
                </button>
            </div>
            ${renderTranslateTestResult(ui.settingsTest, escapeHtml)}
        </section>
    `;
    }

    return {
        id: 'translate',
        label: '翻译',
        isAvailable() {
            return true;
        },
        render,
    };
}

// 翻译请求客户端（B3）：把「翻译一段文本」接到后端 /api/translate/<服务>，聊天消息翻译、角色卡翻译、设置页的测试共用。
// 只读 state.settings（翻译设置）和 state.secretState（密钥是否已填写），不写任何东西。
import {
    describeTranslateFailure,
    describeTranslatePrivacy,
    getOneRingLanguages,
    getTranslateProvider,
    resolveTranslateSettings,
    translateText as runTranslation,
} from '../core/translation.js';

const PRIVACY_ACK_STORAGE_KEY = 'st-modern-translate-privacy-ack';

/**
 * 用户已确认过「文本会发给翻译服务」的服务 id 列表，存在浏览器本地；换了翻译服务要重新确认。
 * @returns {string[]} 服务 id
 */
export function readPrivacyAcks() {
    try {
        const value = JSON.parse(localStorage.getItem(PRIVACY_ACK_STORAGE_KEY) || '[]');
        return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * @param {string} providerId 翻译服务 id
 */
export function rememberPrivacyAck(providerId) {
    try {
        const acks = new Set(readPrivacyAcks());
        acks.add(providerId);
        localStorage.setItem(PRIVACY_ACK_STORAGE_KEY, JSON.stringify([...acks]));
    } catch {
        // 存不下就每次都问，不影响翻译本身
    }
}

/**
 * 翻译失败时抛出的错误：message 已经是面向用户的中文说明。
 */
export class TranslateError extends Error {
    /**
     * @param {string} message 面向用户的说明
     * @param {string} [name] 错误名，取消时为 AbortError
     */
    constructor(message, name = 'TranslateError') {
        super(message);
        this.name = name;
    }
}

/**
 * @param {{ state: any, apiFetchResponse: Function }} deps 依赖
 * @returns {object} 翻译客户端
 */
export function createTranslationClient({ state, apiFetchResponse }) {
    function getSettings() {
        return resolveTranslateSettings(state.settings);
    }

    function hasSecret(key) {
        const value = state.secretState?.[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    }

    /**
     * 这个翻译服务缺不缺必需的密钥或地址；缺的话请求发出去也只会失败，不如先说明。
     * @param {ReturnType<typeof resolveTranslateSettings>} [settings] 翻译设置
     * @returns {{ ready: boolean, reason: string }} ready 为 false 时 reason 是要补什么
     */
    function checkProviderReady(settings = getSettings()) {
        const provider = getTranslateProvider(settings.provider);
        if (!provider) {
            return { ready: false, reason: '没有选择翻译服务。' };
        }
        if (provider.keyRequired && !hasSecret(provider.keySecret)) {
            return { ready: false, reason: `${provider.label} 需要先填写 API Key。到「设置 → 聊天工具 → 翻译」填写。` };
        }
        if (provider.urlRequired && !hasSecret(provider.urlSecret)) {
            return { ready: false, reason: `${provider.label} 需要先填写服务地址。到「设置 → 聊天工具 → 翻译」填写。` };
        }
        return { ready: true, reason: '' };
    }

    /**
     * 当前翻译服务的隐私说明，以及用户是不是已经确认过。
     * @param {ReturnType<typeof resolveTranslateSettings>} [settings] 翻译设置
     * @returns {{ providerId: string, text: string, acknowledged: boolean }} 隐私提示
     */
    function getPrivacyNotice(settings = getSettings()) {
        const provider = getTranslateProvider(settings.provider);
        if (!provider) {
            return { providerId: settings.provider, text: '', acknowledged: true };
        }
        return {
            providerId: provider.id,
            text: describeTranslatePrivacy(provider, provider.urlSecret ? hasSecret(provider.urlSecret) : false),
            acknowledged: readPrivacyAcks().includes(provider.id),
        };
    }

    function buildRequestBody(provider, text, lang, settings) {
        switch (provider.id) {
            case 'deepl':
                return { text, lang, endpoint: settings.deepl_endpoint };
            case 'yandex':
                return { chunks: [text], lang };
            case 'oneringtranslator':
                return { text, ...getOneRingLanguages(lang, settings) };
            default:
                return { text, lang };
        }
    }

    /**
     * 翻译一块文本。响应按纯文本读取：apiFetch 会把 "42" 这样的译文解析成数字，让译文变形。
     * @param {string} text 一块文本
     * @param {string} lang 目标语言码
     * @param {ReturnType<typeof resolveTranslateSettings>} settings 翻译设置
     * @param {AbortSignal} [signal] 取消信号
     * @returns {Promise<string>} 译文
     */
    async function requestChunk(text, lang, settings, signal) {
        const provider = getTranslateProvider(settings.provider);
        if (!provider) {
            throw new TranslateError('没有选择翻译服务。');
        }

        let translated;
        try {
            const response = await apiFetchResponse(`/api/translate/${provider.route}`, {
                body: buildRequestBody(provider, text, lang, settings),
                signal,
            });
            translated = await response.text();
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new TranslateError('翻译已取消。', 'AbortError');
            }
            throw new TranslateError(describeTranslateFailure(error, provider.id));
        }

        if (!translated.trim()) {
            throw new TranslateError(describeTranslateFailure({ code: 'empty_response' }, provider.id));
        }
        return translated;
    }

    /**
     * 翻译一段文本（保护宏和标签、分块、还原、核对占位符）。服务缺密钥或地址时直接抛出说明。
     * @param {string} text 原文
     * @param {object} [options] 选项
     * @param {string} [options.lang] 目标语言码，默认取设置里的目标语言
     * @param {ReturnType<typeof resolveTranslateSettings>} [options.settings] 翻译设置
     * @param {'split' | 'placeholder'} [options.imageMode] 图片链接的处理，见 core/translation.js
     * @param {AbortSignal} [options.signal] 取消信号
     * @returns {Promise<import('../core/translation.js').TranslateTextResult & { lang: string, provider: string }>} 译文和占位符核对结果
     */
    async function translate(text, { lang = '', settings = getSettings(), imageMode = 'split', signal } = {}) {
        const provider = getTranslateProvider(settings.provider);
        if (!provider) {
            throw new TranslateError('没有选择翻译服务。');
        }
        const readiness = checkProviderReady(settings);
        if (!readiness.ready) {
            throw new TranslateError(readiness.reason);
        }

        const targetLanguage = lang || settings.target_language;
        try {
            const result = await runTranslation(text, {
                chunkLimit: provider.chunkLimit,
                imageMode,
                signal,
                translateChunk: chunk => requestChunk(chunk, targetLanguage, settings, signal),
            });
            return { ...result, lang: targetLanguage, provider: provider.id };
        } catch (error) {
            if (error instanceof TranslateError) {
                throw error;
            }
            if (error?.name === 'AbortError') {
                throw new TranslateError('翻译已取消。', 'AbortError');
            }
            // 占位符保护失败（文本里本来就有和占位符相同的符号）等本地错误
            throw new TranslateError(error?.message || String(error));
        }
    }

    return {
        checkProviderReady,
        getPrivacyNotice,
        getSettings,
        hasSecret,
        translate,
    };
}

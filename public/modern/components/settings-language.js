// 设置中心「语言」标签：角色回复语言、翻译目标语言、自动翻译外语开场白，以及主提示词里手写语言规则的提示。
// 回复语言存在 power_user.reply_language（public/shared/reply-language.js），生成引擎和 Agent 会话都按它在聊天记录之后加一句语言要求。
import {
    REPLY_LANGUAGE_FOLLOW,
    REPLY_LANGUAGE_NONE,
    REPLY_LANGUAGE_OPTIONS,
    findLegacyLanguageRule,
    getReplyLanguageOption,
    resolveReplyLanguage,
} from '../../shared/reply-language.js';
import { getLanguageLabel, getTranslatorLabel, resolveTranslateSettings } from '../core/translation.js';
import { renderTranslateLanguageOptions } from './settings-tool-translate.js';

/** 翻译目标语言下拉里「跟随回复语言」的值。 */
export const TRANSLATE_TARGET_FOLLOW = '__follow__';

/**
 * 主提示词和系统提示词里有没有手写的语言规则。
 * @param {Record<string, any>} settings state.settings
 * @returns {boolean} 是否有
 */
export function hasLegacyLanguageRule(settings) {
    const main = (settings?.oai_settings?.prompts || []).find(prompt => prompt?.identifier === 'main');
    return Boolean(findLegacyLanguageRule(main?.content) || findLegacyLanguageRule(settings?.power_user?.sysprompt?.content));
}

export function createSettingsLanguageComponents(ctx) {
    const { state, escapeHtml } = ctx;

    function renderReplyLanguageOptions(selected) {
        const options = [
            ...REPLY_LANGUAGE_OPTIONS.map(option => ({ value: option.value, label: option.label })),
            { value: REPLY_LANGUAGE_FOLLOW, label: '跟随我的消息' },
            { value: REPLY_LANGUAGE_NONE, label: '不指定（由角色卡和提示词决定）' },
        ];
        return options.map(option => `<option value="${escapeHtml(option.value)}" ${option.value === selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
    }

    function renderSettingsLanguageSection() {
        const settings = state.settings || {};
        const replyLanguage = resolveReplyLanguage(settings.power_user);
        const replyOption = getReplyLanguageOption(replyLanguage);
        const translate = resolveTranslateSettings(settings);
        const followTarget = translate.follow_reply_language && Boolean(replyOption);
        const legacyRule = hasLegacyLanguageRule(settings);

        return `
        <section class="panel section-panel settings-language" data-settings-language data-preserve-inputs>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">语言</h2>
                    <p class="panel-subtitle">角色回复用什么语言、译文翻译成什么语言。改动会自动保存。</p>
                </div>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>角色回复语言</span>
                        <select class="select-input" data-reply-language>${renderReplyLanguageOptions(replyLanguage)}</select>
                        <span class="field-help">生成回复时，在聊天记录之后加一句语言要求，角色卡是英文也会用这种语言回复。摘要等后台任务不受影响。</span>
                    </label>
                    <label class="field-label">
                        <span>翻译目标语言</span>
                        <select class="select-input" data-translate-target>
                            <option value="${TRANSLATE_TARGET_FOLLOW}" ${followTarget ? 'selected' : ''} ${replyOption ? '' : 'disabled'}>跟随角色回复语言${replyOption ? `（${escapeHtml(replyOption.label)}）` : ''}</option>
                            ${renderTranslateLanguageOptions(followTarget ? '' : translate.target_language, escapeHtml)}
                        </select>
                        <span class="field-help">消息、开场白和角色卡的译文翻译成这种语言。当前翻译方式：${escapeHtml(getTranslatorLabel(translate))}。</span>
                    </label>
                </div>
                <label class="checkbox-card">
                    <input type="checkbox" data-translate-auto-greeting ${translate.auto_greeting ? 'checked' : ''}>
                    <span>打开聊天时，自动翻译不是${escapeHtml(getLanguageLabel(translate.target_language))}的开场白（只用于显示，原文不变）</span>
                </label>
                ${legacyRule ? `
                <div class="settings-language-legacy" role="note" data-legacy-language-rule>
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <div>
                        <strong>主提示词里有一句手写的语言规则</strong>
                        <p>「Always reply in the same language as {{user}}'s latest message…」要求跟随你的消息语言，会和上面的回复语言冲突。删掉后以这里的设置为准；预设文件里如果也有这句，重新应用预设会把它带回来。</p>
                        <button class="secondary-button compact-button" type="button" data-remove-legacy-language-rule>
                            <i class="fa-solid fa-eraser" aria-hidden="true"></i>
                            删除这句规则
                        </button>
                    </div>
                </div>` : ''}
            </div>
        </section>`;
    }

    return {
        renderSettingsLanguageSection,
    };
}

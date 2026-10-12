// 设置中心「语言」标签的事件：每个字段改动即保存（actions/settings-autosave.js），保存后生成引擎重载设置。
import { removeLegacyLanguageRule } from '../../shared/reply-language.js';
import { TRANSLATE_TARGET_FOLLOW } from '../components/settings-language.js';

export function createSettingsLanguageEvents(ctx) {
    const { state, render, settingsAutosave } = ctx;

    async function handleChange(event) {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.matches('[data-reply-language]')) {
            await settingsAutosave.commit({ changes: [[['power_user', 'reply_language'], target.value]], label: '角色回复语言' });
            // 翻译目标语言可能跟随它，说明文字也要更新
            render();
            return true;
        }
        if (target instanceof HTMLSelectElement && target.matches('[data-translate-target]')) {
            const changes = target.value === TRANSLATE_TARGET_FOLLOW
                ? [[['extension_settings', 'translate', 'follow_reply_language'], true]]
                : [
                    [['extension_settings', 'translate', 'follow_reply_language'], false],
                    [['extension_settings', 'translate', 'target_language'], target.value],
                ];
            await settingsAutosave.commit({ changes: /** @type {Array<[string[], unknown]>} */ (changes), label: '翻译目标语言' });
            render();
            return true;
        }
        if (target instanceof HTMLInputElement && target.matches('[data-translate-auto-greeting]')) {
            await settingsAutosave.commit({ changes: [[['extension_settings', 'translate', 'auto_greeting'], target.checked]], label: '开场白自动翻译' });
            return true;
        }
        return false;
    }

    async function handleClick(event) {
        if (!(event.target instanceof Element) || !event.target.closest('[data-remove-legacy-language-rule]')) {
            return false;
        }
        const settings = state.settings || {};
        /** @type {Array<[string[], unknown]>} */
        const changes = [];
        const prompts = Array.isArray(settings.oai_settings?.prompts) ? settings.oai_settings.prompts : [];
        const mainIndex = prompts.findIndex(prompt => prompt?.identifier === 'main');
        if (mainIndex >= 0 && typeof prompts[mainIndex].content === 'string') {
            const cleaned = removeLegacyLanguageRule(prompts[mainIndex].content);
            if (cleaned !== prompts[mainIndex].content) {
                changes.push([['oai_settings', 'prompts', String(mainIndex), 'content'], cleaned]);
            }
        }
        const sysprompt = settings.power_user?.sysprompt?.content;
        if (typeof sysprompt === 'string') {
            const cleaned = removeLegacyLanguageRule(sysprompt);
            if (cleaned !== sysprompt) {
                changes.push([['power_user', 'sysprompt', 'content'], cleaned]);
            }
        }
        if (changes.length) {
            await settingsAutosave.commit({ changes, label: '主提示词' });
        }
        render();
        return true;
    }

    return {
        handleChange,
        handleClick,
    };
}

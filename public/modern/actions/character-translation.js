// 角色卡翻译（B3）：把编辑表单里的文字字段逐个翻译，只填进未保存的草稿（state.characterEditing.form）。
// 保存沿用角色编辑的保存路径（merge-attributes）；放弃修改、基线对比都用编辑器现成的草稿机制，
// 所以翻译期间和翻译之后都不会碰角色卡文件，也不会调用 /api/characters/merge-attributes。
//
// 宏（{{char}} / {{user}}）、HTML 标签（含 <START>）、Markdown 图片链接和代码块先换成带编号的占位符，译完还原；
// 占位符数量对不上的字段保持原文并标红，不会把半截的译文写进草稿。
import { describePlaceholderIssues, readCharacterFieldValue, replaceCharacterFieldValue, buildCharacterTranslationJobs } from '../core/translation.js';
import { createTranslationClient, rememberPrivacyAck } from './translation-client.js';

/**
 * 单个字段在界面上的状态。
 * pending 等待 / running 翻译中 / done 已填入草稿 / restored 已恢复原文 / mismatch 占位符对不上，保持原文 /
 * conflict 翻译期间你改过这个字段，没有覆盖 / error 请求失败 / skipped 因停止或前面的失败而没有翻译
 * @typedef {'pending' | 'running' | 'done' | 'restored' | 'mismatch' | 'conflict' | 'error' | 'skipped'} CharacterTranslationStatus
 */

/**
 * @param {any} state 全局状态
 * @returns {any} 补齐字段的 state.characterTranslation
 */
export function ensureCharacterTranslationState(state) {
    if (!state.characterTranslation || typeof state.characterTranslation !== 'object') {
        state.characterTranslation = {};
    }
    const ui = state.characterTranslation;
    ui.avatar ??= '';
    ui.running ??= false;
    ui.copying ??= false;
    // '' | 'draft' | 'copy'：正在等用户确认隐私提示的是哪个按钮
    ui.confirm ??= '';
    ui.items ??= [];
    ui.summary ??= '';
    ui.controller ??= null;
    return ui;
}

export function createCharacterTranslationActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    actionRegistry,
}) {
    const client = createTranslationClient({ state, apiFetchResponse });

    function isCurrent(ui, form) {
        return state.characterTranslation === ui && state.characterEditing.form === form;
    }

    function summarize(items, stopped) {
        const count = status => items.filter(item => item.status === status).length;
        const parts = [`已翻译 ${count('done')} 个字段，结果在未保存的草稿里`];
        if (count('mismatch')) parts.push(`${count('mismatch')} 个字段的占位内容对不上，保持了原文`);
        if (count('conflict')) parts.push(`${count('conflict')} 个字段在翻译期间被你改过，没有覆盖`);
        if (count('error')) parts.push(`${count('error')} 个字段翻译失败`);
        if (stopped) parts.push('翻译已停止');
        return parts.join('；');
    }

    // 翻译当前打开的编辑表单；copy 流程里 avatar 是刚复制出来的副本
    async function runDraftTranslation(avatar, { confirmed = false } = {}) {
        const editing = state.characterEditing;
        if (!editing.avatar || editing.avatar !== avatar || !editing.form) {
            throw new Error('请先打开要翻译的角色的编辑区。');
        }
        const current = ensureCharacterTranslationState(state);
        if (current.running || current.copying) {
            return;
        }

        const settings = client.getSettings();
        const readiness = client.checkProviderReady(settings);
        if (!readiness.ready) {
            throw new Error(readiness.reason);
        }
        const notice = client.getPrivacyNotice(settings);
        if (!notice.acknowledged && !confirmed) {
            current.avatar = avatar;
            current.confirm = 'draft';
            render();
            return;
        }
        if (!notice.acknowledged) {
            rememberPrivacyAck(notice.providerId);
        }

        const form = editing.form;
        const jobs = buildCharacterTranslationJobs(form);
        if (!jobs.length) {
            throw new Error('这张角色卡没有可翻译的文字字段。');
        }

        const controller = new AbortController();
        /** @type {{ id: string, field: string, index?: number, label: string, status: CharacterTranslationStatus, message: string }[]} */
        const items = jobs.map(job => ({ id: job.id, field: job.field, index: job.index, label: job.label, status: 'pending', message: '' }));
        // 换一个对象，旧的翻译状态（含上一次还在跑的循环）随之失效
        state.characterTranslation = { avatar, running: true, copying: false, confirm: '', items, summary: '', controller };
        const ui = state.characterTranslation;
        render();

        const markRest = (fromIndex, message) => {
            for (let rest = fromIndex; rest < items.length; rest++) {
                if (items[rest].status === 'pending' || items[rest].status === 'running') {
                    items[rest].status = 'skipped';
                    items[rest].message = message;
                }
            }
        };

        let stopped = false;
        let failed = false;
        for (let position = 0; position < jobs.length; position++) {
            const job = jobs[position];
            const item = items[position];
            if (!isCurrent(ui, form)) {
                markRest(position, '编辑区已关闭，翻译已停止。');
                stopped = true;
                break;
            }
            if (controller.signal.aborted) {
                markRest(position, '翻译已停止。');
                stopped = true;
                break;
            }

            item.status = 'running';
            render();
            try {
                const result = await client.translate(job.text, { settings, imageMode: 'placeholder', signal: controller.signal });
                if (!isCurrent(ui, form)) {
                    markRest(position, '编辑区已关闭，翻译已停止。');
                    stopped = true;
                    break;
                }
                if (readCharacterFieldValue(form, job) !== job.text) {
                    item.status = 'conflict';
                    item.message = '翻译期间你修改了这个字段，没有覆盖。';
                } else if (!result.ok) {
                    item.status = 'mismatch';
                    item.message = `${describePlaceholderIssues(result.issues)}，已保持原文。可以重试或换一个翻译服务。`;
                } else {
                    form[job.field] = replaceCharacterFieldValue(form, job, result.text);
                    item.status = 'done';
                }
            } catch (error) {
                if (error?.name === 'AbortError') {
                    markRest(position, '翻译已停止。');
                    stopped = true;
                    break;
                }
                item.status = 'error';
                item.message = error.message;
                markRest(position + 1, '前面的字段翻译失败，已停止。');
                stopped = true;
                failed = true;
                render();
                break;
            }
            render();
        }

        if (state.characterTranslation === ui) {
            ui.running = false;
            ui.controller = null;
            ui.summary = summarize(items, stopped);
            showToast(failed ? '角色卡翻译失败' : stopped ? '角色卡翻译已停止' : '角色卡翻译完成', failed ? items.find(item => item.status === 'error').message : ui.summary);
        }
        render();
    }

    /**
     * 翻译当前编辑中的角色卡：逐字段翻译并填进未保存的草稿。第一次使用某个翻译服务时先显示隐私确认，确认后带 { confirmed: true } 再调用。
     * @param {{ confirmed?: boolean }} [options] confirmed：用户已确认隐私提示
     */
    async function translateCharacterDraft({ confirmed = false } = {}) {
        await runDraftTranslation(state.characterEditing.avatar, { confirmed });
    }

    /**
     * 复制当前角色，再把副本翻译进它自己的草稿；原角色卡不改。副本是 /api/characters/duplicate 创建的真实文件，
     * 翻译结果仍在未保存的草稿里，不保存就还是原文的副本。
     * @param {{ confirmed?: boolean }} [options] confirmed：用户已确认隐私提示
     */
    async function translateCharacterCopy({ confirmed = false } = {}) {
        const sourceAvatar = state.characterEditing.avatar;
        if (!sourceAvatar) {
            throw new Error('请先打开要复制的角色的编辑区。');
        }
        const current = ensureCharacterTranslationState(state);
        if (current.running || current.copying) {
            return;
        }

        // 先确认服务可用、隐私已确认，再创建副本，免得留下一个没翻译的空副本
        const settings = client.getSettings();
        const readiness = client.checkProviderReady(settings);
        if (!readiness.ready) {
            throw new Error(readiness.reason);
        }
        const notice = client.getPrivacyNotice(settings);
        if (!notice.acknowledged && !confirmed) {
            current.avatar = sourceAvatar;
            current.confirm = 'copy';
            render();
            return;
        }
        if (!notice.acknowledged) {
            rememberPrivacyAck(notice.providerId);
        }

        current.confirm = '';
        current.copying = true;
        render();
        let nextAvatar = '';
        try {
            const result = await apiFetch('/api/characters/duplicate', { body: { avatar_url: sourceAvatar } });
            nextAvatar = result?.path || result?.avatar || '';
            if (!nextAvatar) {
                throw new Error('复制角色没有返回新角色的文件名。');
            }
            state.selected.character = nextAvatar;
            state.selected.chat = '';
            await loadData({ silent: true });
            // 打开副本的编辑区；当前角色有未保存的修改时，会转存为它自己的草稿
            await actionRegistry.characterActions.beginCharacterEdit(nextAvatar);
            if (state.characterEditing.avatar !== nextAvatar) {
                throw new Error(`已创建副本 ${nextAvatar}，但没能打开它的编辑区。`);
            }
        } catch (error) {
            current.copying = false;
            render();
            throw error;
        }

        current.copying = false;
        showToast('已创建副本', `${nextAvatar}，正在翻译；翻译结果在未保存的草稿里。`);
        await runDraftTranslation(nextAvatar, { confirmed: true });
    }

    /** 停止正在进行的翻译；已经填进草稿的字段保留。 */
    function stopCharacterTranslation() {
        const ui = ensureCharacterTranslationState(state);
        ui.controller?.abort();
    }

    function cancelCharacterTranslationConfirm() {
        ensureCharacterTranslationState(state).confirm = '';
        render();
    }

    /**
     * 把一个已翻译的字段恢复成打开编辑器时的原文（基线）。
     * @param {string} itemId 字段任务 id，如 description 或 alternate_greetings:0
     */
    function restoreTranslatedCharacterField(itemId) {
        const ui = ensureCharacterTranslationState(state);
        const item = ui.items.find(entry => entry.id === itemId);
        const editing = state.characterEditing;
        if (!item || editing.avatar !== ui.avatar || !editing.form) {
            return;
        }
        const original = readCharacterFieldValue(editing.baseline, item);
        editing.form[item.field] = replaceCharacterFieldValue(editing.form, item, original);
        item.status = 'restored';
        item.message = '';
        render();
    }

    return {
        translateCharacterDraft,
        translateCharacterCopy,
        stopCharacterTranslation,
        cancelCharacterTranslationConfirm,
        restoreTranslatedCharacterField,
    };
}

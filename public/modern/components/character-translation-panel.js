// 角色编辑区里的「翻译角色卡」面板（B3）：翻译按钮、隐私确认、逐字段进度和每个字段的「查看原文 / 恢复原文」。
// 业务在 actions/character-translation.js，事件在 routes/characters-events.js；翻译结果只进未保存的草稿。
import {
    getLanguageShortLabel,
    getTranslateProvider,
    isChineseLanguage,
    readCharacterFieldValue,
    resolveTranslateSettings,
} from '../core/translation.js';

const STATUS_LABELS = Object.freeze({
    pending: '等待',
    running: '翻译中…',
    done: '已填入草稿',
    restored: '已恢复原文',
    mismatch: '未覆盖：占位内容对不上',
    conflict: '未覆盖：翻译期间被修改',
    error: '翻译失败',
    skipped: '未翻译',
});

export function createCharacterTranslationPanel(ctx) {
    const { state, escapeHtml } = ctx;

    function renderItem(item) {
        const original = item.status === 'done' ? readCharacterFieldValue(state.characterEditing.baseline, item) : '';
        return `
            <li class="character-translation-item is-${escapeHtml(item.status)}" data-character-translation-item="${escapeHtml(item.id)}" data-translation-status="${escapeHtml(item.status)}">
                <span class="character-translation-field">${escapeHtml(item.label)}</span>
                <span class="character-translation-status">${escapeHtml(STATUS_LABELS[item.status] || item.status)}</span>
                ${item.status === 'done' ? `<button class="secondary-button compact-button character-translation-restore" type="button" data-restore-character-field="${escapeHtml(item.id)}">恢复原文</button>` : ''}
                ${item.message ? `<span class="character-translation-message">${escapeHtml(item.message)}</span>` : ''}
                ${item.status === 'done' ? `
                <details class="character-translation-original">
                    <summary>查看原文</summary>
                    <pre>${escapeHtml(original)}</pre>
                </details>` : ''}
            </li>`;
    }

    function renderConfirm(kind) {
        const notice = ctx.getChatTranslationNotice?.() || { text: '', targetLabel: '' };
        return `
            <div class="message-translation is-confirm" role="note" data-character-translation-confirm="${escapeHtml(kind)}">
                <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                <span>${escapeHtml(notice.text)}角色卡的文字字段会逐个发送，结果只填进未保存的草稿。继续吗？</span>
                <button class="secondary-button compact-button" type="button" data-cancel-character-translation-confirm>取消</button>
                <button class="primary-button compact-button" type="button" data-confirm-character-translation="${escapeHtml(kind)}">同意并翻译</button>
            </div>`;
    }

    /**
     * @returns {string} 面板 HTML，只用于编辑表单
     */
    function renderCharacterTranslationPanel() {
        const editingAvatar = state.characterEditing.avatar;
        if (!editingAvatar) {
            return '';
        }

        const ui = state.characterTranslation || {};
        const active = ui.avatar === editingAvatar;
        const running = active && Boolean(ui.running);
        const copying = active && Boolean(ui.copying);
        const busy = running || copying;
        const settings = resolveTranslateSettings(state.settings);
        const providerLabel = getTranslateProvider(settings.provider)?.label || settings.provider;
        const targetLabel = getLanguageShortLabel(settings.target_language);
        const buttonLabel = isChineseLanguage(settings.target_language) ? '翻译为中文' : `翻译为${targetLabel}`;
        const items = active && Array.isArray(ui.items) ? ui.items : [];

        return `
        <section class="character-translation" data-character-translation ${running ? 'aria-busy="true"' : ''}>
            <div class="character-translation-head">
                <div>
                    <strong>翻译角色卡</strong>
                    <p class="panel-subtitle">把描述、性格、场景、首条消息、示例消息、作者备注、系统提示词、历史后置提示和备用开场白翻译成${escapeHtml(targetLabel)}（${escapeHtml(providerLabel)}）。结果只填进下面这份未保存的草稿，保存前可以逐项查看原文、恢复原文或放弃修改。角色卡文字会作为提示词发给模型，翻译后请检查再保存。</p>
                </div>
                <div class="message-edit-actions">
                    ${running ? `
                    <button class="secondary-button" type="button" data-stop-character-translation>
                        <i class="fa-solid fa-stop"></i>
                        停止
                    </button>` : ''}
                    <button class="secondary-button" type="button" data-translate-character-copy ${busy ? 'disabled' : ''} title="先复制出一张新角色卡，再把译文填进副本的草稿；当前这张不改">
                        <i class="fa-solid ${copying ? 'fa-circle-notch fa-spin' : 'fa-copy'}"></i>
                        ${copying ? '复制中…' : '复制后翻译'}
                    </button>
                    <button class="primary-button" type="button" data-translate-character-draft ${busy ? 'disabled aria-busy="true"' : ''}>
                        <i class="fa-solid ${running ? 'fa-circle-notch fa-spin' : 'fa-language'}"></i>
                        ${running ? '翻译中…' : buttonLabel}
                    </button>
                </div>
            </div>
            ${active && ui.confirm ? renderConfirm(ui.confirm) : ''}
            ${items.length ? `<ul class="character-translation-items" data-character-translation-items>${items.map(renderItem).join('')}</ul>` : ''}
            ${active && ui.summary ? `<p class="character-translation-summary" role="status" data-character-translation-summary>${escapeHtml(ui.summary)}</p>` : ''}
        </section>
    `;
    }

    return {
        renderCharacterTranslationPanel,
    };
}

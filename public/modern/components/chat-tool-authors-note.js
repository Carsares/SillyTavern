// 聊天工具「作者注释」面板（A5）：编辑聊天头里的作者注释，二期含角色注释和全局默认值。
// 业务逻辑在 actions/chat-authors-note.js，事件在 routes/chat-tool-authors-note-events.js，接入方式见 chat-tools.js 顶部注释。
// 输入框的改动只写进草稿、不重新渲染（重渲染会让输入框失去焦点）；联动（下次插入时间、「默认」标记、深度和角色的显隐）
// 由事件文件按 data-an-* 属性就地更新，所以这里每个会变化的节点都带着对应的 data-an-* 属性。
import {
    AUTHORS_NOTE_POSITIONS,
    AUTHORS_NOTE_ROLES,
    AUTHORS_NOTE_SECTIONS,
    CHARACTER_NOTE_POSITIONS,
} from '../actions/chat-authors-note.js';

export function createChatToolAuthorsNotePanel(ctx) {
    const { escapeHtml } = ctx;

    function renderChip(view, field) {
        return `<span class="badge authors-note-chip" data-an-chip="${field}" title="这一项没有单独设置，正在使用「默认值」里的设置" ${view.chips?.[field] ? '' : 'hidden'}>默认</span>`;
    }

    function renderError(view, field) {
        return `<span class="field-error" data-an-error="${field}" role="alert" ${view.errors?.[field] ? '' : 'hidden'}>${escapeHtml(view.errors?.[field] || '')}</span>`;
    }

    function renderRadioGroup(view, { name, field, legend, options, chip = false }) {
        return `
        <fieldset class="authors-note-radios" data-an-group="${field}">
            <legend><span class="authors-note-label">${legend}${chip ? renderChip(view, field) : ''}</span></legend>
            <div class="authors-note-options">
                ${options.map(option => `
                    <label class="checkbox-card">
                        <input type="radio" name="${name}" value="${option.value}" data-an-scope="${view.scope}" data-an-field="${field}" ${String(option.value) === view.draft[field] ? 'checked' : ''}>
                        <span>${escapeHtml(option.label)}</span>
                    </label>
                `).join('')}
            </div>
            ${renderError(view, field)}
        </fieldset>
    `;
    }

    function renderPromptField(view, { placeholder, chip }) {
        return `
        <label class="field-label">
            <span class="authors-note-label">注释内容${chip ? renderChip(view, 'prompt') : ''}</span>
            <textarea rows="8" data-an-scope="${view.scope}" data-an-field="prompt" placeholder="${escapeHtml(placeholder)}" aria-invalid="${view.errors?.prompt ? 'true' : 'false'}">${escapeHtml(view.draft.prompt)}</textarea>
            ${renderError(view, 'prompt')}
        </label>
    `;
    }

    function renderIntervalField(view, { chip }) {
        return `
        <label class="field-label">
            <span class="authors-note-label">插入频率${chip ? renderChip(view, 'interval') : ''}</span>
            <input class="text-input" type="number" min="0" max="9999" step="1" inputmode="numeric" data-an-scope="${view.scope}" data-an-field="interval" value="${escapeHtml(view.draft.interval)}" aria-invalid="${view.errors?.interval ? 'true' : 'false'}">
            <span class="authors-note-hint">0 = 关闭，1 = 每次生成都插入，N = 每 N 条用户消息插入一次</span>
            ${renderError(view, 'interval')}
        </label>
    `;
    }

    function renderDepthAndRole(view, { chip }) {
        const inChat = view.draft.position === '1';
        return `
        <div class="form-grid two-columns" data-an-depth-group ${inChat ? '' : 'hidden'}>
            <label class="field-label">
                <span class="authors-note-label">深度${chip ? renderChip(view, 'depth') : ''}</span>
                <input class="text-input" type="number" min="0" max="9999" step="1" inputmode="numeric" data-an-scope="${view.scope}" data-an-field="depth" value="${escapeHtml(view.draft.depth)}" aria-invalid="${view.errors?.depth ? 'true' : 'false'}">
                <span class="authors-note-hint">0 = 最新消息之后，数字越大越靠前</span>
                ${renderError(view, 'depth')}
            </label>
            <label class="field-label">
                <span class="authors-note-label">角色${chip ? renderChip(view, 'role') : ''}</span>
                <select class="select-input" data-an-scope="${view.scope}" data-an-field="role">
                    ${AUTHORS_NOTE_ROLES.map(role => `<option value="${role.value}" ${String(role.value) === view.draft.role ? 'selected' : ''}>${escapeHtml(role.label)}</option>`).join('')}
                </select>
                <span class="authors-note-hint">以哪种身份的消息放进提示词</span>
                ${renderError(view, 'role')}
            </label>
        </div>
    `;
    }

    function renderFeedback(view) {
        return `
        <div class="authors-note-feedback">
            <p class="authors-note-message error" role="alert" data-an-message="error" ${view.error ? '' : 'hidden'}>${escapeHtml(view.error || '')}</p>
            <p class="authors-note-message warning" role="alert" data-an-message="warning" ${view.warning ? '' : 'hidden'}>${escapeHtml(view.warning || '')}</p>
            <p class="authors-note-message success" role="status" data-an-message="notice" ${view.notice ? '' : 'hidden'}>${escapeHtml(view.notice || '')}</p>
        </div>
    `;
    }

    function renderActions(view, scope, saveLabel = '保存') {
        const blocked = view.saving || view.generating;
        return `
        ${view.generating ? '<p class="authors-note-hint">正在生成，生成结束后才能保存作者注释。</p>' : ''}
        <div class="authors-note-actions">
            <span class="badge" data-an-dirty ${view.dirty ? '' : 'hidden'}>有未保存的修改</span>
            <button class="secondary-button" type="button" data-an-reset="${scope}" ${view.saving ? 'disabled' : ''}>
                <i class="fa-solid fa-rotate-left"></i>
                还原
            </button>
            <button class="primary-button" type="button" data-an-save="${scope}" ${blocked ? 'disabled' : ''}>
                <i class="fa-solid ${view.saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}"></i>
                ${view.saving ? '保存中' : saveLabel}
            </button>
        </div>
    `;
    }

    function renderChatSection(view) {
        return `
        <div class="settings-form authors-note-form" data-an-scope="chat">
            <p class="panel-subtitle">保存后写入聊天文件，下一次生成起生效。</p>
            ${renderPromptField(view, { placeholder: '例如：[文风：细腻、克制；视角：第三人称]', chip: true })}
            ${renderIntervalField(view, { chip: true })}
            <div class="authors-note-schedule" data-an-schedule data-schedule-kind="${escapeHtml(view.schedule.kind)}">
                <strong data-an-schedule-text>${escapeHtml(view.schedule.text)}</strong>
                <span class="authors-note-hint" data-an-schedule-detail ${view.schedule.detail ? '' : 'hidden'}>${escapeHtml(view.schedule.detail)}</span>
            </div>
            ${renderRadioGroup(view, { name: 'an-position-chat', field: 'position', legend: '插入位置', options: AUTHORS_NOTE_POSITIONS, chip: true })}
            ${renderDepthAndRole(view, { chip: true })}
            ${renderFeedback(view)}
            ${renderActions(view, 'chat')}
        </div>
    `;
    }

    function renderCharacterSection(view) {
        return `
        <div class="settings-form authors-note-form" data-an-scope="chara">
            <p class="panel-subtitle">${escapeHtml(view.characterName)} 专用的作者注释，不会随角色卡导出。勾选「使用角色注释」后，它和本聊天的作者注释一起按插入频率插入。</p>
            ${renderPromptField(view, { placeholder: '例如：[场景：热闹的集市；类型：爱情喜剧]', chip: false })}
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-an-scope="chara" data-an-field="useChara" ${view.useChara ? 'checked' : ''}>
                <span>使用角色注释</span>
            </label>
            ${renderRadioGroup(view, { name: 'an-position-chara', field: 'position', legend: '与作者注释的关系', options: CHARACTER_NOTE_POSITIONS })}
            ${renderFeedback(view)}
            ${renderActions(view, 'chara')}
        </div>
    `;
    }

    function renderDefaultSection(view) {
        return `
        <div class="settings-form authors-note-form" data-an-scope="default">
            <p class="panel-subtitle">新建的聊天，以及还没有单独设置这一项的聊天，使用这里的值。已经设置过、或生成过回复的聊天保留自己的值。保存后会让生成引擎重新打开当前聊天，立即读到新的默认值。</p>
            ${renderPromptField(view, { placeholder: '例如：[文风：细腻、克制；视角：第三人称]', chip: false })}
            ${renderIntervalField(view, { chip: false })}
            ${renderRadioGroup(view, { name: 'an-position-default', field: 'position', legend: '插入位置', options: AUTHORS_NOTE_POSITIONS })}
            ${renderDepthAndRole(view, { chip: false })}
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-an-scope="default" data-an-field="allowWIScan" ${view.draft.allowWIScan === '1' ? 'checked' : ''}>
                <span>作者注释参与世界书扫描（对所有聊天生效）</span>
            </label>
            ${renderFeedback(view)}
            ${renderActions(view, 'default')}
        </div>
    `;
    }

    function renderBody(view) {
        if (!view.ready) {
            return `<p class="panel-subtitle authors-note-unavailable">${escapeHtml(view.reason)}</p>`;
        }
        if (view.scope === 'chara') {
            return renderCharacterSection(view);
        }
        return view.scope === 'default' ? renderDefaultSection(view) : renderChatSection(view);
    }

    return {
        id: 'authors-note',
        label: '作者注释',
        icon: 'fa-note-sticky',
        // 选中了聊天文件就可用：作者注释存在聊天头里，单人聊天和群聊都有
        isAvailable() {
            return !!ctx.isAuthorsNoteAvailable?.();
        },
        render() {
            const view = ctx.getAuthorsNoteView();
            return `
            <div class="authors-note" data-authors-note>
                <div class="segmented-control authors-note-sections" role="tablist" aria-label="作者注释范围">
                    ${AUTHORS_NOTE_SECTIONS.map(section => `
                        <button class="${section.id === view.scope ? 'active' : ''}" type="button" role="tab" data-an-section="${section.id}" aria-selected="${section.id === view.scope}">
                            ${escapeHtml(section.label)}
                        </button>
                    `).join('')}
                </div>
                ${renderBody(view)}
            </div>
        `;
        },
    };
}

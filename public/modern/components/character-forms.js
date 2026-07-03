import { createCharacterFormFieldComponents } from './character-form-fields.js';

export function createCharacterFormComponents(ctx) {
    const {
        state,
        escapeHtml,
        characterToForm,
    } = ctx;
    const { renderCharacterFormContent } = createCharacterFormFieldComponents(ctx);

    function renderCharacterCreatePanel() {
        return `
        <div class="settings-form inline-form">
            <strong>新建角色</strong>
            ${renderCharacterFormContent(state.characterCreating.form, 'create', true)}
        </div>
    `;
    }

    function renderCharacterEditPanel(character) {
        return `
        <div class="settings-form inline-form">
            <strong>编辑角色卡</strong>
            ${renderCharacterFormContent(state.characterEditing.form || characterToForm(character), 'edit', false)}
        </div>
    `;
    }

    function renderCharacterRenamePanel(character) {
        return `
        <div class="settings-form inline-form">
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>新名称</span>
                    <input class="text-input" type="text" data-character-rename-input value="${escapeHtml(state.characterRenaming.name)}">
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-character-rename>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-confirm-character-rename>
                    <i class="fa-solid fa-check"></i>
                    保存重命名
                </button>
            </div>
            <p class="panel-subtitle">将同步更新卡片名称、PNG 文件名和对应聊天目录：${escapeHtml(character.avatar || '')}</p>
        </div>
    `;
    }

    function renderCharacterDeletePanel(character) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除角色</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(state.characterDeleteConfirm.name || character.avatar)} 的角色卡文件。</p>
            </div>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-character-delete-chats ${state.characterDeleteConfirm.deleteChats ? 'checked' : ''}>
                <span>同时删除聊天记录目录</span>
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-character-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-character-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderCharacterCreatePanel,
        renderCharacterEditPanel,
        renderCharacterRenamePanel,
        renderCharacterDeletePanel,
    };
}

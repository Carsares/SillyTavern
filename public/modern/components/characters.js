import { createCharacterFormComponents } from './character-forms.js';

export function createCharactersComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatNumber,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderInlineEmpty,
        renderKeyValue,
        matchesQuery,
        getCharacterAvatarUrl,
        getCharacterTags,
    } = ctx;
    const {
        renderCharacterCreatePanel,
        renderCharacterEditPanel,
        renderCharacterRenamePanel,
        renderCharacterDeletePanel,
    } = createCharacterFormComponents(ctx);

    function renderCharacters() {
        const characters = state.characters.filter(character => matchesQuery(character.name, character.avatar, character.data?.creator, character.data?.tags?.join(' ')));
        const selected = state.characters.find(character => character.avatar === state.selected.character) || characters[0];
        if (selected && state.selected.character !== selected.avatar) {
            state.selected.character = selected.avatar;
        }

        return `
        ${pageHead('角色库', '角色卡、来源、世界书和聊天占用。', `
            <button class="primary-button" type="button" data-create-character>
                <i class="fa-solid fa-plus"></i>
                新建角色
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-upload"></i>
                导入文件
                <input class="visually-hidden" type="file" accept=".png,.json,.yaml,.yml,.charx,.byaf" data-character-import-file>
            </label>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">角色列表</h2>
                        <p class="panel-subtitle">${formatNumber(characters.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.characterCreating.active ? renderCharacterCreatePanel() : ''}
                <div class="resource-list">
                    ${characters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无匹配角色')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderCharacterDetail(selected) : renderEmptyState('fa-address-card', '暂无角色', '当前用户目录里没有角色卡。')}
            </section>
        </div>
    `;
    }

    function renderCharacterDetail(character) {
        const detail = state.characterDetails[character.avatar] || character;
        const avatar = getCharacterAvatarUrl(detail);
        const name = detail.name || detail.data?.name || '未命名角色';
        const tags = getCharacterTags(detail);
        const isEditing = state.characterEditing.avatar === character.avatar;
        const isRenaming = state.characterRenaming.avatar === character.avatar;
        const isDeleting = state.characterDeleteConfirm.avatar === character.avatar;

        return `
        <div class="detail-hero character-detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : '<span class="avatar-fallback large">C</span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(detail.avatar || character.avatar || '角色卡')}</p>
                <div class="tag-row detail-tags">
                    ${tags.slice(0, 8).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="tag">未打标签</span>'}
                </div>
            </div>
            <div class="detail-actions page-actions">
                <button class="secondary-button" type="button" data-load-character-detail="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-database"></i>
                    读取完整卡
                </button>
                <button class="secondary-button" type="button" data-edit-character="${escapeHtml(character.avatar)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-duplicate-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-copy"></i>
                    复制
                </button>
                <button class="secondary-button" type="button" data-rename-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-i-cursor"></i>
                    重命名
                </button>
                <label class="secondary-button file-action">
                    <i class="fa-solid fa-image"></i>
                    替换头像
                    <input class="visually-hidden" type="file" accept="image/*" data-character-avatar-file="${escapeHtml(character.avatar)}">
                </label>
                <button class="secondary-button" type="button" data-export-character="${escapeHtml(character.avatar)}" data-character-export-format="png">
                    <i class="fa-solid fa-image"></i>
                    PNG
                </button>
                <button class="secondary-button" type="button" data-export-character="${escapeHtml(character.avatar)}" data-character-export-format="json">
                    <i class="fa-solid fa-file-code"></i>
                    JSON
                </button>
                <button class="secondary-button" type="button" data-delete-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
        </div>
        ${isRenaming ? renderCharacterRenamePanel(detail) : ''}
        ${isDeleting ? renderCharacterDeletePanel(detail) : ''}
        ${isEditing ? renderCharacterEditPanel(detail) : ''}
        <div class="character-meta-grid">
            ${renderKeyValue('创建时间', formatDate(detail.create_date || detail.date_added))}
            ${renderKeyValue('最近聊天', formatDate(detail.date_last_chat))}
            ${renderKeyValue('聊天占用', formatBytes(detail.chat_size))}
            ${renderKeyValue('卡片大小', formatBytes(detail.data_size))}
            ${renderKeyValue('作者', detail.data?.creator || '未知')}
            ${renderKeyValue('关联世界书', detail.data?.extensions?.world || '未关联')}
        </div>
        <p class="detail-text">${escapeHtml(detail.description || detail.data?.description || detail.data?.creator_notes || '当前列表接口未返回完整角色描述。')}</p>
    `;
    }

    return {
        renderCharacters,
    };
}

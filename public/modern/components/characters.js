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
        renderRouteFilter,
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

    function getVisibleCharacters() {
        return state.characters.filter(character => matchesQuery(character.name, character.avatar, character.data?.creator, character.data?.tags?.join(' ')));
    }

    function getSelectedCharacter(characters = getVisibleCharacters()) {
        const selected = state.characters.find(character => character.avatar === state.selected.character) || characters[0];
        if (selected && state.selected.character !== selected.avatar) {
            state.selected.character = selected.avatar;
        }

        return selected;
    }

    function renderCharacterListPanel() {
        const characters = getVisibleCharacters();

        return `
            <section class="panel" data-character-list-panel>
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">角色列表</h2>
                        <p class="panel-subtitle">${formatNumber(characters.length)} 个匹配项</p>
                    </div>
                    ${renderRouteFilter('筛选角色', '名称、文件名、作者或标签')}
                </div>
                ${state.characterCreating.active ? renderCharacterCreatePanel() : ''}
                <div class="resource-list" data-character-list>
                    ${characters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无匹配角色')}
                </div>
            </section>
        `;
    }

    function renderCharacterDetailPanel() {
        const selected = getSelectedCharacter();

        return `
            <section class="panel" data-character-detail-panel>
                ${selected ? renderCharacterDetail(selected) : renderEmptyState('fa-address-card', '暂无角色', '当前用户目录里没有角色卡。')}
            </section>
        `;
    }

    function renderCharacters() {
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
            ${renderCharacterListPanel()}
            ${renderCharacterDetailPanel()}
        </div>
    `;
    }

    function renderCharacterSelection() {
        const detailPanel = document.querySelector('[data-character-detail-panel]');
        if (!detailPanel) {
            return false;
        }

        document.querySelectorAll('[data-select-character]').forEach(button => {
            button.classList.toggle('active', /** @type {HTMLElement} */ (button).dataset.selectCharacter === state.selected.character);
        });
        detailPanel.outerHTML = renderCharacterDetailPanel();
        return true;
    }

    function renderCharacterDetail(character) {
        const detail = state.characterDetails[character.avatar] || character;
        const avatar = getCharacterAvatarUrl(detail);
        const name = detail.name || detail.data?.name || '未命名角色';
        const tags = getCharacterTags(detail);
        const isEditing = state.characterEditing.avatar === character.avatar;
        const isRenaming = state.characterRenaming.avatar === character.avatar;
        const isDeleting = state.characterDeleteConfirm.avatar === character.avatar;
        const description = detail.description || detail.data?.description || detail.data?.creator_notes || '当前列表接口未返回完整角色描述。';
        const canExpandDescription = description.length > 260;

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
        <section class="detail-description">
            ${canExpandDescription ? '<input class="visually-hidden detail-description-toggle" id="character-description-toggle" type="checkbox" data-character-description-toggle>' : ''}
            <div class="detail-description-header">
                <h3 class="detail-description-title">角色描述</h3>
                ${canExpandDescription ? `
                    <label class="secondary-button detail-description-action" for="character-description-toggle" data-toggle-character-description>
                        <span class="detail-description-expand"><i class="fa-solid fa-chevron-down"></i> 展开</span>
                        <span class="detail-description-collapse"><i class="fa-solid fa-chevron-up"></i> 收起</span>
                    </label>
                ` : ''}
            </div>
            <p class="detail-text">${escapeHtml(description)}</p>
        </section>
    `;
    }

    return {
        renderCharacters,
        renderCharacterSelection,
    };
}

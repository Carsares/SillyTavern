import { formatCharacterCreator, getCharacterWorldStatus, withDisplayCreator } from '../actions/character-data.js';
import { getEmbeddedBookInfo } from '../core/character-book.js';
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
        getCharacterEditDraft,
    } = ctx;
    const {
        renderCharacterCreatePanel,
        renderCharacterEditPanel,
        renderCharacterRenamePanel,
        renderCharacterDeletePanel,
        refreshCharacterFormActions,
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
                    ${characters.map(character => renderCharacterRow(withDisplayCreator(character))).join('') || renderInlineEmpty('暂无匹配角色')}
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
        const draft = getCharacterEditDraft(character.avatar);
        const description = detail.description || detail.data?.description || detail.data?.creator_notes || '当前列表接口未返回完整角色描述。';
        const canExpandDescription = description.length > 260;
        const isLoadingDetail = state.characterDetailLoading === character.avatar;

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
                <button class="primary-button" type="button" data-route="chat" data-open-character-chat="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-comments"></i>
                    开始聊天
                </button>
                <button
                    class="secondary-button"
                    type="button"
                    data-load-character-detail="${escapeHtml(character.avatar)}"
                    title="从角色卡文件重新读取全部字段（列表接口可能只返回部分字段）"
                    ${isLoadingDetail ? 'disabled aria-busy="true"' : ''}
                >
                    <i class="fa-solid ${isLoadingDetail ? 'fa-circle-notch fa-spin' : 'fa-database'}"></i>
                    ${isLoadingDetail ? '读取中…' : '读取完整卡'}
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
                <button class="secondary-button danger-action" type="button" data-delete-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-trash-can"></i>
                    删除
                </button>
            </div>
        </div>
        ${!isEditing && draft ? renderCharacterDraftNotice(character.avatar) : ''}
        ${isRenaming ? renderCharacterRenamePanel(detail) : ''}
        ${isDeleting ? renderCharacterDeletePanel(detail) : ''}
        ${isEditing ? renderCharacterEditPanel(detail) : ''}
        <div class="character-meta-grid">
            ${renderKeyValue('创建时间', formatDate(detail.create_date || detail.date_added))}
            ${renderKeyValue('最近聊天', formatDate(detail.date_last_chat))}
            ${renderKeyValue('聊天占用', formatBytes(detail.chat_size))}
            ${renderKeyValue('卡片大小', formatBytes(detail.data_size))}
            ${renderCharacterCreatorRow(detail.data?.creator)}
            ${renderCharacterWorldRow(detail.data?.extensions?.world)}
        </div>
        ${renderCharacterEmbeddedWorld(detail, character.avatar)}
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

    // 与 renderKeyValue 结构一致，额外支持自定义悬浮说明和状态样式。
    function renderCharacterMetaRow(key, value, { title = value, className = '', icon = '', attributes = '' } = {}) {
        return `
            <div class="kv-row" ${attributes}>
                <span class="kv-key">${escapeHtml(key)}</span>
                <span class="kv-value${className ? ` ${className}` : ''}" title="${escapeHtml(title)}">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${escapeHtml(value)}</span>
            </div>
        `;
    }

    function renderCharacterCreatorRow(rawCreator) {
        const creator = formatCharacterCreator(rawCreator);
        const raw = String(rawCreator ?? '');
        return renderCharacterMetaRow('作者', creator || '未知', {
            title: creator && raw !== creator ? `${creator}（卡片原始值：${raw}）` : (creator || '卡片没有填写作者'),
            className: creator ? '' : 'is-empty',
            attributes: 'data-character-creator',
        });
    }

    function renderCharacterWorldRow(world) {
        const status = getCharacterWorldStatus(world, state);
        if (status === 'none') {
            return renderCharacterMetaRow('关联世界书', '未关联', { className: 'is-empty', attributes: 'data-character-world="none"' });
        }
        if (status === 'missing') {
            return renderCharacterMetaRow('关联世界书', `${world}（未找到）`, {
                title: `世界书目录里没有「${world}」，这个关联目前不会生效。可以导入同名世界书，或在编辑角色时重新选择。`,
                className: 'is-warning',
                icon: 'fa-triangle-exclamation',
                attributes: 'data-character-world="missing"',
            });
        }

        return renderCharacterMetaRow('关联世界书', world, { attributes: `data-character-world="${status}"` });
    }

    // 角色卡内嵌世界书（data.character_book）：生成只读取 data.extensions.world 指向的世界书文件，
    // 没有导入并关联的内嵌世界书不会参与生成，所以这里标出状态并提供「导入并关联」。
    function renderCharacterEmbeddedWorld(detail, avatar) {
        const info = getEmbeddedBookInfo(detail);
        // 懒加载模式下列表只返回摘要（没有 character_book），读取完整卡之前无法判断
        if (!info.has) {
            return detail.shallow === true
                ? `
        <div class="character-embedded-world" data-character-embedded-world="unknown">
            <div class="character-embedded-world-summary">
                <span class="kv-key">内嵌世界书</span>
                <span class="kv-value is-empty">未检查，点上方「读取完整卡」后显示</span>
            </div>
        </div>`
                : '';
        }

        const ui = state.characterEmbeddedWorld || {};
        const world = String(detail.data?.extensions?.world ?? '').trim();
        const worldStatus = getCharacterWorldStatus(world, state);
        const linked = worldStatus === 'found';
        const importing = ui.importing === avatar;
        // 别的角色正在写入时不并发；别的角色停在重名选择上时不拦着，点导入会把那个选择当作取消
        const otherBusy = Boolean(ui.importing) && !importing && !ui.conflict;
        let summary = `${formatNumber(info.entryCount)} 条 · 未导入`;
        let title = '这张角色卡自带世界书，但还没有导入。未导入、未关联时，生成不会使用它。';
        if (linked) {
            summary = `${formatNumber(info.entryCount)} 条 · 已关联「${world}」`;
            title = `卡里的内嵌世界书已作为独立世界书「${world}」关联到这个角色。`;
        } else if (worldStatus === 'missing') {
            summary = `${formatNumber(info.entryCount)} 条 · 未导入（原关联「${world}」未找到）`;
            title = `世界书目录里没有「${world}」。导入时会优先使用这个名称重新创建并恢复关联。`;
        } else if (worldStatus === 'unknown') {
            summary = `${formatNumber(info.entryCount)} 条 · 无法确认是否已导入`;
            title = '世界书列表读取失败，无法确认这个角色是否已关联世界书。';
        }

        return `
        <div class="character-embedded-world${linked ? '' : ' is-pending'}" data-character-embedded-world="${linked ? 'linked' : 'pending'}">
            <div class="character-embedded-world-summary">
                <span class="kv-key">内嵌世界书</span>
                <span class="kv-value" title="${escapeHtml(title)}">${escapeHtml(summary)}</span>
            </div>
            ${linked ? '' : `
            <button
                class="secondary-button"
                type="button"
                data-import-character-embedded-world="${escapeHtml(avatar)}"
                title="把卡里的世界书导入为独立的世界书文件，并关联到这个角色"
                ${importing || otherBusy ? 'disabled aria-busy="true"' : ''}
            >
                <i class="fa-solid ${importing ? 'fa-circle-notch fa-spin' : 'fa-book-atlas'}"></i>
                ${importing ? '导入中…' : '导入并关联'}
            </button>`}
        </div>
        ${!linked && ui.prompt === avatar && !importing ? renderCharacterEmbeddedWorldPrompt(avatar, info, otherBusy) : ''}
        ${ui.conflict?.avatar === avatar ? renderCharacterEmbeddedWorldConflict(ui.conflict) : ''}`;
    }

    // 导入角色卡后的一次性询问（旧版在选中角色时弹确认框，这里改成详情里的内联提示）。
    function renderCharacterEmbeddedWorldPrompt(avatar, info, otherBusy) {
        return `
        <div class="settings-form inline-form character-draft-notice" data-character-embedded-world-prompt="${escapeHtml(avatar)}">
            <div class="character-form-status">
                <span class="dot warning"></span>
                <span><strong>这张角色卡带有内嵌世界书</strong> 共 ${formatNumber(info.entryCount)} 条。现在导入并关联吗？不导入的话，生成时不会使用它。</span>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-dismiss-character-embedded-world-prompt>
                    <i class="fa-solid fa-xmark"></i>
                    暂不导入
                </button>
                <button class="primary-button" type="button" data-import-character-embedded-world="${escapeHtml(avatar)}" ${otherBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-book-atlas"></i>
                    导入并关联
                </button>
            </div>
        </div>`;
    }

    // 世界书名称已被占用：内联给出「另存为 / 覆盖 / 取消」，不用 window.confirm。
    function renderCharacterEmbeddedWorldConflict(conflict) {
        return `
        <div class="settings-form inline-form danger-panel" data-character-embedded-world-conflict>
            <div>
                <strong>已有同名世界书「${escapeHtml(conflict.existingName)}」</strong>
                <p class="panel-subtitle">要导入的内嵌世界书（${formatNumber(conflict.entryCount)} 条）和它重名。可以另存为「${escapeHtml(conflict.alternateName)}」，也可以覆盖已有内容。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-character-embedded-world-conflict-choice="cancel">
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button" type="button" data-character-embedded-world-conflict-choice="overwrite">
                    <i class="fa-solid fa-rotate"></i>
                    覆盖「${escapeHtml(conflict.existingName)}」
                </button>
                <button class="primary-button" type="button" data-character-embedded-world-conflict-choice="rename">
                    <i class="fa-solid fa-copy"></i>
                    另存为「${escapeHtml(conflict.alternateName)}」
                </button>
            </div>
        </div>`;
    }

    // 编辑区已收起但仍有未保存修改时，在角色详情顶部提示，并提供继续编辑与放弃两个出口。
    function renderCharacterDraftNotice(avatar) {
        return `
        <div class="settings-form inline-form character-draft-notice" data-character-draft-notice="${escapeHtml(avatar)}">
            <div class="character-form-status">
                <span class="dot warning"></span>
                <span><strong>有未保存的修改</strong> 上次编辑的内容还没有保存到角色卡。</span>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button danger-action" type="button" data-discard-character-draft="${escapeHtml(avatar)}">
                    <i class="fa-solid fa-trash-can"></i>
                    放弃修改
                </button>
                <button class="primary-button" type="button" data-resume-character-draft="${escapeHtml(avatar)}">
                    <i class="fa-solid fa-pen"></i>
                    继续编辑
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderCharacters,
        renderCharacterSelection,
        refreshCharacterFormActions,
    };
}

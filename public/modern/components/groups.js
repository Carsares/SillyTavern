import { createGroupFormComponents } from './group-forms.js';

export function createGroupsComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatNumber,
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        matchesQuery,
        getChatEntityAvatarUrl,
        getCharacterByAvatar,
    } = ctx;
    const {
        renderGroupCreatePanel,
        renderGroupEditPanel,
        renderGroupDeletePanel,
    } = createGroupFormComponents(ctx);

    function renderGroups() {
        const groups = state.groups.filter(group => matchesQuery(group.name, group.id, ...(Array.isArray(group.members) ? group.members : [])));
        const selected = state.groups.find(group => group.id === state.selected.group) || groups[0];
        if (selected && state.selected.group !== selected.id) {
            state.selected.group = selected.id;
        }

        return `
        ${pageHead('群组管理', '群聊成员、生成策略和聊天文件归属。', `
            <button class="primary-button" type="button" data-create-group>
                <i class="fa-solid fa-plus"></i>
                新建群组
            </button>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">群组列表</h2>
                        <p class="panel-subtitle">${formatNumber(groups.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.groupCreating.active ? renderGroupCreatePanel() : ''}
                <div class="resource-list">
                    ${groups.map(group => renderGroupRow(group)).join('') || renderInlineEmpty('暂无匹配群组')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderGroupDetail(selected) : renderEmptyState('fa-users', '暂无群组', '当前用户目录里没有群组。')}
            </section>
        </div>
    `;
    }

    function renderGroupDetail(group) {
        const avatar = getChatEntityAvatarUrl(group);
        const memberAvatars = Array.isArray(group.members) ? group.members : [];
        const members = memberAvatars.map(avatarId => getCharacterByAvatar(avatarId)).filter(Boolean);
        const missingMembers = memberAvatars.filter(avatarId => !getCharacterByAvatar(avatarId));
        const isEditing = state.groupEditing.id === group.id;
        const isDeleting = state.groupDeleteConfirm.id === group.id;

        return `
        <div class="detail-hero">
            ${avatar ? `<img class="avatar large" src="${escapeHtml(avatar)}" alt="">` : '<span class="avatar-fallback large"><i class="fa-solid fa-users"></i></span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(group.name || group.id || '未命名群组')}</h2>
                <p class="panel-subtitle">${escapeHtml(group.id)} · ${formatNumber(memberAvatars.length)} 个成员 · ${formatNumber((group.chats || []).length)} 个会话</p>
                <div class="tag-row detail-tags">
                    <span class="tag">${group.allow_self_responses ? '允许自回复' : '禁止自回复'}</span>
                    <span class="tag">策略 ${formatNumber(group.activation_strategy ?? 0)}</span>
                    <span class="tag">模式 ${formatNumber(group.generation_mode ?? 0)}</span>
                    ${group.fav ? '<span class="tag">收藏</span>' : ''}
                </div>
            </div>
            <div class="detail-actions page-actions">
                <button class="secondary-button" type="button" data-route="chat" data-open-group-chat="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-comments"></i>
                    打开聊天
                </button>
                <button class="secondary-button" type="button" data-edit-group="${escapeHtml(group.id)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-delete-group="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
        </div>
        ${isDeleting ? renderGroupDeletePanel(group) : ''}
        ${isEditing ? renderGroupEditPanel(group) : ''}
        <div class="metrics-grid compact-metrics">
            ${metricCard('成员', formatNumber(memberAvatars.length), `${formatNumber(missingMembers.length)} 个缺失`, 'fa-users')}
            ${metricCard('聊天文件', formatNumber((group.chats || []).length), formatBytes(group.chat_size), 'fa-message')}
            ${metricCard('最近聊天', group.date_last_chat ? formatDate(group.date_last_chat) : '暂无', '群组聊天记录', 'fa-clock')}
        </div>
        <section class="panel section-panel">
            <div class="panel-header compact-header">
                <div>
                    <h3 class="panel-title">成员</h3>
                    <p class="panel-subtitle">按群组成员顺序展示角色卡。</p>
                </div>
            </div>
            <div class="resource-list">
                ${members.map(character => renderCharacterRow(character)).join('')}
                ${missingMembers.map(avatarId => `
                    <div class="resource-row">
                        <span class="avatar-fallback"><i class="fa-solid fa-triangle-exclamation"></i></span>
                        <span class="row-main">
                            <span class="row-title">${escapeHtml(avatarId)}</span>
                            <span class="row-subtitle">角色卡缺失或未读取</span>
                        </span>
                    </div>
                `).join('')}
                ${memberAvatars.length ? '' : renderInlineEmpty('这个群组还没有成员')}
            </div>
        </section>
    `;
    }

    return {
        renderGroups,
    };
}

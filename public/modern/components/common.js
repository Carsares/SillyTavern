import { escapeHtml, formatDate, formatNumber } from '../core/utils.js';
import { routeLabels } from '../core/constants.js';

export function createCommonComponents({ state, getCharacterAvatarUrl, getGroupAvatarUrl, getEntityUnreadCount = () => 0 }) {
    function pageHead(title, description, actions = '') {
        return `
            <div class="page-head">
                <div>
                    <p class="eyebrow">${escapeHtml(routeLabels[state.route] || 'Workspace')}</p>
                    <h1 class="page-title">${escapeHtml(title)}</h1>
                    ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ''}
                </div>
                <div class="page-actions">${actions}</div>
            </div>
        `;
    }

    function metricCard(label, value, detail, icon) {
        return `
            <section class="metric-card">
                <div class="metric-label"><i class="fa-solid ${icon}"></i> ${escapeHtml(label)}</div>
                <div class="metric-value">${escapeHtml(value)}</div>
                <div class="metric-delta">${escapeHtml(detail)}</div>
            </section>
        `;
    }

    function renderInlineEmpty(text) {
        return `<div class="muted">${escapeHtml(text)}</div>`;
    }

    function renderRouteFilter(label = '筛选当前页', placeholder = '输入关键词筛选当前列表') {
        return `
            <label class="field-label route-filter">
                <span>${escapeHtml(label)}</span>
                <input class="text-input" type="search" data-route-filter value="${escapeHtml(state.query)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
            </label>
        `;
    }

    function renderUnreadBadge(count, label) {
        if (!count) {
            return '';
        }

        return `<span class="unread-badge" data-unread-count="${count}" aria-label="${escapeHtml(label)}"><span class="dot danger"></span>${formatNumber(count)}</span>`;
    }

    function renderCharacterRow(character) {
        const avatar = getCharacterAvatarUrl(character);
        const title = character.name || character.data?.name || character.avatar || '未命名角色';
        const unreadCount = getEntityUnreadCount(character);
        const subtitle = [
            character.data?.creator ? `作者 ${character.data.creator}` : '',
            character.date_last_chat ? `最近 ${formatDate(character.date_last_chat)}` : '',
        ].filter(Boolean).join(' · ') || character.avatar || '角色卡';

        return `
            <button class="resource-row ${state.selected.character === character.avatar ? 'active' : ''} ${unreadCount ? 'unread' : ''}" type="button" data-select-character="${escapeHtml(character.avatar)}">
                ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : '<span class="avatar-fallback">C</span>'}
                <span class="row-main">
                    <span class="row-title">${escapeHtml(title)}</span>
                    <span class="row-subtitle">${escapeHtml(subtitle)}</span>
                </span>
                ${renderUnreadBadge(unreadCount, `${title} 有 ${formatNumber(unreadCount)} 条未读消息`)}
            </button>
        `;
    }

    function renderGroupRow(group) {
        const avatar = getGroupAvatarUrl(group);
        const memberCount = Array.isArray(group.members) ? group.members.length : 0;
        const chatCount = Array.isArray(group.chats) ? group.chats.length : 0;
        const unreadCount = getEntityUnreadCount(group);
        const subtitle = [
            `${formatNumber(memberCount)} 个成员`,
            `${formatNumber(chatCount)} 个会话`,
            group.date_last_chat ? `最近 ${formatDate(group.date_last_chat)}` : '',
        ].filter(Boolean).join(' · ') || group.id || '群聊';

        return `
            <button class="resource-row ${state.selected.group === group.id ? 'active' : ''} ${unreadCount ? 'unread' : ''}" type="button" data-select-group="${escapeHtml(group.id)}">
                ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="">` : '<span class="avatar-fallback"><i class="fa-solid fa-users"></i></span>'}
                <span class="row-main">
                    <span class="row-title">${escapeHtml(group.name || group.id || '未命名群聊')}</span>
                    <span class="row-subtitle">${escapeHtml(subtitle)}</span>
                </span>
                ${renderUnreadBadge(unreadCount, `${group.name || group.id || '未命名群聊'} 有 ${formatNumber(unreadCount)} 条未读消息`)}
            </button>
        `;
    }

    function renderKeyValue(key, value) {
        return `
            <div class="kv-row">
                <span class="kv-key">${escapeHtml(key)}</span>
                <span class="kv-value" title="${escapeHtml(value ?? '未设置')}">${escapeHtml(value ?? '未设置')}</span>
            </div>
        `;
    }

    function renderEmptyState(icon, title, description) {
        return `
            <div class="empty-state">
                <div>
                    <i class="fa-solid ${icon}"></i>
                    <strong>${escapeHtml(title)}</strong>
                    <div>${escapeHtml(description)}</div>
                </div>
            </div>
        `;
    }

    function renderLoading() {
        return `
            <div class="loading-state">
                <div>
                    <i class="fa-solid fa-circle-notch fa-spin"></i>
                    <strong>正在读取 SillyTavern 数据</strong>
                    <div>角色、世界书、预设、素材和扩展会并发加载。</div>
                </div>
            </div>
        `;
    }

    return {
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        renderKeyValue,
        renderLoading,
        renderRouteFilter,
    };
}

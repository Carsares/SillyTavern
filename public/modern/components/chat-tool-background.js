// 聊天工具「聊天背景」面板（B5）：显示当前背景来源、选择或上传聊天锁定背景、跟随全局、调整遮罩。
// 背景图本身画在消息列表后面（插槽见 chat-backdrop.js），事件见 routes/chat-tool-background-events.js。
// 接入方式见 chat-tools.js 顶部注释；没有选中会话时面板不可用，抽屉里没有这个标签。
import { TRANSPARENT_BACKGROUND_NAME, MAX_CHAT_BG_DIM, MIN_CHAT_BG_DIM } from '../core/chat-background.js';

const SOURCE_LABELS = { chat: '聊天锁定', global: '全局', none: '无' };

export function createChatToolBackgroundPanel(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        getChatBackgroundInfo,
        getBackgroundFilename,
        getBackgroundUrl,
    } = ctx;

    function describeSource(info) {
        const { resolved } = info;
        const globalName = info.globalIsNone ? '无背景' : info.global.name;
        if (resolved.source === 'chat') {
            return `这个聊天固定使用该背景，不受全局背景影响。全局背景：${globalName}。`;
        }
        if (resolved.source === 'global') {
            return resolved.lockFailed
                ? '这个聊天锁定的背景无法加载，已回退到全局背景；可以重新选择，或点「跟随全局」清除锁定。'
                : '这个聊天没有锁定背景，跟随全局背景。';
        }
        if (resolved.lockedNone) {
            return `这个聊天锁定为无背景。全局背景：${globalName}。`;
        }
        return resolved.lockFailed ? '这个聊天锁定的背景无法加载，全局也没有背景。' : '全局背景是无背景，这个聊天也没有锁定背景。';
    }

    /**
     * @param {{ attribute: string, value: string, name: string, thumbnailUrl?: string, icon?: string, selected: boolean, isGlobal: boolean, disabled: boolean, title: string }} tile 缩略图卡片。
     * @returns {string} 卡片 HTML。
     */
    function renderTile({ attribute, value, name, thumbnailUrl = '', icon = 'fa-image', selected, isGlobal, disabled, title }) {
        return `
        <button class="chat-bg-tile ${selected ? 'selected' : ''}" type="button" ${attribute}="${escapeHtml(value)}" aria-pressed="${selected ? 'true' : 'false'}" title="${escapeHtml(title)}" ${disabled ? 'disabled' : ''}>
            ${thumbnailUrl
        ? `<img class="chat-bg-tile-thumb" src="${escapeHtml(thumbnailUrl)}" alt="" loading="lazy">`
        : `<span class="chat-bg-tile-thumb chat-bg-tile-empty"><i class="fa-solid ${icon}"></i></span>`}
            <span class="chat-bg-tile-name">${escapeHtml(name)}</span>
            ${selected || isGlobal ? `
                <span class="chat-bg-tile-tags">
                    ${selected ? '<span class="tag">本聊天</span>' : ''}
                    ${isGlobal ? '<span class="tag">全局</span>' : ''}
                </span>
            ` : ''}
        </button>
    `;
    }

    function renderLibrary(info) {
        const background = state.chatBackground;
        const query = (background.query || '').trim().toLowerCase();
        const matches = name => !query || String(name).toLowerCase().includes(query);
        const lockPath = info.lock?.relativePath || '';
        const globalPath = info.global?.relativePath || '';
        const disabled = !info.canEdit;

        const noneTile = renderTile({
            attribute: 'data-chat-bg-pick-none',
            value: '1',
            name: '无背景',
            icon: 'fa-ban',
            selected: info.resolved.lockedNone,
            isGlobal: info.globalIsNone,
            disabled,
            title: '锁定为无背景：这个聊天不显示背景，即使全局设置了背景',
        });
        const chatTiles = info.chatImages
            .filter(item => matches(item.parsed.name))
            .map(item => renderTile({
                attribute: 'data-chat-bg-pick-chat',
                value: item.path,
                name: item.parsed.name,
                thumbnailUrl: item.parsed.url,
                selected: lockPath === item.parsed.relativePath,
                isGlobal: false,
                disabled,
                title: `本聊天专属图：${item.parsed.name}`,
            }));
        const images = (Array.isArray(state.backgrounds?.images) ? state.backgrounds.images : [])
            .map(getBackgroundFilename)
            .filter(filename => filename && filename !== TRANSPARENT_BACKGROUND_NAME && matches(filename));
        const visibleImages = images.slice(0, background.visibleCount);
        const systemTiles = visibleImages.map(filename => renderTile({
            attribute: 'data-chat-bg-pick',
            value: filename,
            name: filename,
            thumbnailUrl: getBackgroundUrl(filename),
            selected: lockPath === `backgrounds/${filename}`,
            isGlobal: globalPath === `backgrounds/${filename}`,
            disabled,
            title: `锁定到这个聊天：${filename}`,
        }));
        const remaining = images.length - visibleImages.length;

        return `
        <section class="chat-bg-section" data-chat-bg-library>
            <div class="chat-bg-toolbar">
                <input class="text-input chat-bg-filter" type="search" placeholder="筛选背景文件名" aria-label="筛选背景文件名" value="${escapeHtml(background.query || '')}" data-chat-bg-filter>
                <label class="secondary-button file-action ${disabled ? 'disabled' : ''}" title="上传的图片保存在 user/images，并登记为这个聊天的专属背景">
                    <i class="fa-solid ${info.busy ? 'fa-circle-notch fa-spin' : 'fa-upload'}"></i>
                    上传为本聊天专属背景
                    <input class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,.jfif" data-chat-bg-upload ${disabled ? 'disabled' : ''}>
                </label>
            </div>
            <p class="panel-subtitle">点击缩略图把这个聊天锁定到该背景；全局背景请在素材库里设置。</p>
            ${state.engine?.generating ? '<p class="panel-subtitle chat-bg-warning" role="status">生成中不能修改聊天背景，生成结束后再选择。</p>' : ''}
            <div class="chat-bg-grid" data-chat-bg-grid>
                ${noneTile}
                ${chatTiles.join('')}
                ${systemTiles.join('')}
            </div>
            ${images.length || chatTiles.length ? '' : '<p class="panel-subtitle">没有匹配的背景。</p>'}
            ${remaining > 0 ? `
                <button class="secondary-button load-more-button" type="button" data-chat-bg-more>
                    <i class="fa-solid fa-chevron-down"></i>
                    显示更多 ${formatNumber(remaining)}
                </button>
            ` : ''}
        </section>
    `;
    }

    return {
        id: 'background',
        label: '聊天背景',
        icon: 'fa-image',
        isAvailable() {
            return typeof getChatBackgroundInfo === 'function' && Boolean(getChatBackgroundInfo().target);
        },
        render() {
            const info = getChatBackgroundInfo();
            if (!info.target) {
                return '';
            }
            const { resolved } = info;
            const sourceLabel = SOURCE_LABELS[resolved.source];
            const currentName = resolved.source === 'none' ? (resolved.lockedNone ? '无背景（已锁定）' : '无背景') : resolved.name;
            const canFollowGlobal = info.canEdit && Boolean(info.metadata?.custom_background);

            return `
            <div class="chat-bg-panel" data-chat-bg-panel data-chat-bg-source="${resolved.source}">
                <section class="chat-bg-summary" data-chat-bg-summary>
                    ${resolved.path
        ? `<span class="chat-bg-preview" style="background-image: url('${escapeHtml(resolved.path)}')" aria-hidden="true"></span>`
        : '<span class="chat-bg-preview chat-bg-preview-empty" aria-hidden="true"><i class="fa-regular fa-image"></i></span>'}
                    <div class="chat-bg-summary-main">
                        <div class="chat-bg-source">
                            <span class="tag" data-chat-bg-source-label>${sourceLabel}</span>
                            <strong data-chat-bg-current-name>${escapeHtml(currentName)}</strong>
                        </div>
                        <p class="panel-subtitle">${escapeHtml(describeSource(info))}</p>
                        <div class="row-actions">
                            <button class="secondary-button" type="button" data-chat-bg-follow-global title="清除这个聊天的背景锁定，改为跟随全局背景" ${canFollowGlobal ? '' : 'disabled'}>
                                <i class="fa-solid fa-link"></i>
                                跟随全局
                            </button>
                        </div>
                    </div>
                </section>
                <section class="chat-bg-section chat-bg-display" data-chat-bg-display>
                    <label class="selection-row">
                        <input type="checkbox" data-chat-bg-enabled ${info.enabled ? 'checked' : ''}>
                        <span>在聊天中显示背景</span>
                    </label>
                    <label class="field-label chat-bg-dim">
                        <span>遮罩浓度 <output data-chat-bg-dim-value>${info.dim}%</output></span>
                        <input type="range" min="${MIN_CHAT_BG_DIM}" max="${MAX_CHAT_BG_DIM}" step="5" value="${info.dim}" data-chat-bg-dim ${info.enabled ? '' : 'disabled'}>
                    </label>
                    <p class="panel-subtitle">遮罩用界面底色盖在背景图上，数值越大背景越淡、文字越清晰。显示开关和浓度只保存在这个浏览器里。</p>
                </section>
                ${renderLibrary(info)}
            </div>
        `;
        },
    };
}

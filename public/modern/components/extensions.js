import { createExtensionPanelComponents } from './extension-panels.js';

export function createExtensionsComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderKeyValue,
        matchesQuery,
        getExtensionFolderName,
        canManageExtension,
    } = ctx;
    const {
        renderExtensionInstallPanel,
        renderExtensionDetailsPanel,
        renderExtensionOperationPanel,
    } = createExtensionPanelComponents(ctx);

    function renderExtensions() {
        const matchingExtensions = state.extensions.filter(extension => matchesQuery(extension.name, extension.type));
        const systemCount = matchingExtensions.filter(extension => extension.type === 'system').length;
        const localCount = matchingExtensions.filter(extension => extension.type === 'local').length;
        const globalCount = matchingExtensions.filter(extension => extension.type === 'global').length;
        const manageableCount = matchingExtensions.filter(canManageExtension).length;
        const activeView = getExtensionView();
        const selectedExtensionId = state.selected.extension;
        const extensions = getVisibleExtensions(matchingExtensions, activeView)
            .sort((a, b) => Number(getExtensionId(b) === selectedExtensionId) - Number(getExtensionId(a) === selectedExtensionId));

        return `
        ${pageHead('扩展', '内置、本地和全局扩展。', `
            <button class="primary-button" type="button" data-toggle-extension-install>
                <i class="fa-solid ${state.extensionInstall.active ? 'fa-xmark' : 'fa-plus'}"></i>
                ${state.extensionInstall.active ? '取消安装' : '安装扩展'}
            </button>
        `)}
        ${state.extensionInstall.active ? renderExtensionInstallPanel() : ''}
        <div class="metrics-grid">
            ${metricCard('全部扩展', formatNumber(matchingExtensions.length), '当前匹配项', 'fa-cubes')}
            ${metricCard('内置保护', formatNumber(systemCount), '随应用提供，不做删除更新', 'fa-shield-halved')}
            ${metricCard('本地 / 全局', `${formatNumber(localCount)} / ${formatNumber(globalCount)}`, '用户安装扩展', 'fa-folder-tree')}
            ${metricCard('可管理', formatNumber(manageableCount), state.me?.admin ? '支持移动、更新、删除' : '支持详情、更新、删除', 'fa-screwdriver-wrench')}
        </div>
        ${renderExtensionFilters(activeView, { all: matchingExtensions.length, manageable: manageableCount, system: systemCount, local: localCount, global: globalCount })}
        <div class="extension-grid">
            ${extensions.map(extension => renderExtensionCard(extension)).join('') || `
                <section class="panel section-panel">
                    <p class="muted">当前筛选下暂无扩展。</p>
                </section>
            `}
        </div>
    `;
    }

    function getExtensionView() {
        return ['all', 'manageable', 'system', 'local', 'global'].includes(state.extensionView) ? state.extensionView : 'all';
    }

    function getVisibleExtensions(extensions, activeView) {
        if (activeView === 'manageable') {
            return extensions.filter(canManageExtension);
        }
        if (['system', 'local', 'global'].includes(activeView)) {
            return extensions.filter(extension => extension.type === activeView);
        }
        return extensions;
    }

    function renderExtensionFilters(activeView, counts) {
        const tabs = [
            ['all', 'fa-cubes', '全部', counts.all],
            ['manageable', 'fa-screwdriver-wrench', '可管理', counts.manageable],
            ['system', 'fa-shield-halved', '内置', counts.system],
            ['local', 'fa-folder', '本地', counts.local],
            ['global', 'fa-globe', '全局', counts.global],
        ];
        return `
        <div class="segmented-control extension-tabs" role="tablist" aria-label="扩展筛选">
            ${tabs.map(([id, icon, label, count]) => `
                <button class="${activeView === id ? 'active' : ''}" type="button" data-extension-view="${id}" aria-selected="${activeView === id}">
                    <i class="fa-solid ${icon}"></i>
                    ${label}
                    <span class="badge">${formatNumber(count)}</span>
                </button>
            `).join('')}
        </div>
    `;
    }

    function getExtensionTypeIcon(extension) {
        if (extension.type === 'system') {
            return 'fa-shield-halved';
        }
        if (extension.type === 'global') {
            return 'fa-globe';
        }
        return 'fa-folder';
    }

    function getExtensionId(extension) {
        return `${extension.type || ''}:${getExtensionFolderName(extension)}`;
    }

    function renderExtensionCard(extension) {
        const name = getExtensionFolderName(extension);
        const isManageable = canManageExtension(extension);
        const title = extension.name.replace('third-party/', '');
        const selected = getExtensionId(extension) === state.selected.extension;
        const detailsOpen = state.extensionDetails.name === name && state.extensionDetails.type === extension.type;
        const operationOpen = state.extensionOperation.name === name && state.extensionOperation.type === extension.type;

        return `
        <article class="resource-card extension-card ${selected ? 'selected' : ''}" data-extension-card="${escapeHtml(getExtensionId(extension))}">
            <div class="card-head">
                <div class="extension-card-title">
                    <span class="avatar-fallback"><i class="fa-solid ${getExtensionTypeIcon(extension)}"></i></span>
                    <span class="row-main">
                        <h2 class="card-title">${escapeHtml(title)}</h2>
                        <span class="row-subtitle mono">${escapeHtml(extension.name)}</span>
                    </span>
                </div>
                <span class="tag">${escapeHtml(extension.type)}</span>
            </div>
            <div class="kv-list">
                ${renderKeyValue('文件夹', name)}
                ${renderKeyValue('状态', isManageable ? '可管理' : '内置保护')}
                ${renderKeyValue('权限', state.me?.admin ? '管理员' : '当前用户')}
            </div>
            <div class="extension-card-actions">
                ${isManageable ? `
                    <button class="secondary-button" type="button" data-extension-details="${escapeHtml(name)}" data-extension-type="${escapeHtml(extension.type)}">
                        <i class="fa-solid fa-circle-info"></i>
                        详情
                    </button>
                    <button class="secondary-button" type="button" data-extension-action="update" data-extension-name="${escapeHtml(name)}" data-extension-type="${escapeHtml(extension.type)}">
                        <i class="fa-solid fa-download"></i>
                        更新
                    </button>
                    ${state.me?.admin ? `
                        <button class="secondary-button" type="button" data-extension-action="move" data-extension-name="${escapeHtml(name)}" data-extension-type="${escapeHtml(extension.type)}">
                            <i class="fa-solid fa-right-left"></i>
                            ${extension.type === 'global' ? '移到本地' : '移到全局'}
                        </button>
                    ` : ''}
                    <button class="secondary-button" type="button" data-extension-action="delete" data-extension-name="${escapeHtml(name)}" data-extension-type="${escapeHtml(extension.type)}">
                        <i class="fa-solid fa-ellipsis"></i>
                        管理
                    </button>
                ` : `
                    <span class="badge"><i class="fa-solid fa-lock"></i> 受保护</span>
                `}
            </div>
            ${detailsOpen ? renderExtensionDetailsPanel(extension) : ''}
            ${operationOpen ? renderExtensionOperationPanel(extension) : ''}
        </article>
    `;
    }

    return {
        renderExtensions,
    };
}

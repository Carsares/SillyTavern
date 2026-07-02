import { createAssetBackgroundComponents } from './assets-backgrounds.js';

export function createAssetsComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        renderInlineEmpty,
        matchesQuery,
        getAssetGroups,
        getAssetCount,
        getAssetEntries,
        getBackgroundFilename,
        getBackgroundFolderData,
        getBackgroundFolderById,
        getBackgroundFolderIds,
        getBackgroundFolderCounts,
    } = ctx;
    const {
        renderBackgroundFoldersPanel,
        renderBackgroundLibraryPanel,
    } = createAssetBackgroundComponents(ctx);

    function renderAssets() {
        const selectedAssetId = state.selected.asset;
        const selectedAssetCategory = getSelectedAssetCategory(selectedAssetId);
        const groups = getAssetGroups()
            .filter(group => matchesQuery(group.name))
            .sort((a, b) => Number(b.name === selectedAssetCategory) - Number(a.name === selectedAssetCategory));
        const allBackgrounds = state.backgrounds?.images || [];
        const selectedBackground = state.selected.background;
        const backgroundFolders = getBackgroundFolderData().folders;
        const folderCounts = getBackgroundFolderCounts();
        if (state.backgroundFolderFilter && !getBackgroundFolderById(state.backgroundFolderFilter)) {
            state.backgroundFolderFilter = '';
        }
        if (!state.backgroundFolderAssignment && backgroundFolders[0]) {
            state.backgroundFolderAssignment = backgroundFolders[0].id;
        }
        const backgrounds = allBackgrounds
            .filter(background => matchesQuery(getBackgroundFilename(background)))
            .filter(background => !state.backgroundFolderFilter || getBackgroundFolderIds(getBackgroundFilename(background)).includes(state.backgroundFolderFilter))
            .sort((a, b) => Number(getBackgroundFilename(b) === selectedBackground) - Number(getBackgroundFilename(a) === selectedBackground));
        const visibleBackgrounds = backgrounds.slice(0, state.backgroundVisibleCount);
        const hasMoreBackgrounds = visibleBackgrounds.length < backgrounds.length;
        const selection = state.backgroundSelection;
        const selectedCount = selection.filenames.length;
        const folderFilterName = getBackgroundFolderById(state.backgroundFolderFilter)?.name || '全部背景';
        const assetTab = state.assetTab === 'files' ? 'files' : 'backgrounds';

        return `
        ${pageHead('素材库', '背景、音频、Live2D、VRM 和资产文件。', `
            <button class="primary-button" type="button" data-toggle-asset-download>
                <i class="fa-solid ${state.assetDownload.active ? 'fa-xmark' : 'fa-cloud-arrow-down'}"></i>
                ${state.assetDownload.active ? '取消下载' : '下载资产'}
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-upload"></i>
                上传背景
                <input class="visually-hidden" type="file" accept="image/*,.gif,.webp,.apng" data-background-upload-file>
            </label>
            <button class="secondary-button" type="button" data-toggle-background-selection>
                <i class="fa-solid ${selection.active ? 'fa-xmark' : 'fa-check-square'}"></i>
                ${selection.active ? '退出选择' : '选择背景'}
            </button>
            ${selection.active ? `
                <button class="secondary-button danger-action" type="button" data-delete-selected-backgrounds ${selectedCount ? '' : 'disabled'}>
                    <i class="fa-solid fa-trash"></i>
                    删除所选 ${formatNumber(selectedCount)}
                </button>
            ` : ''}
        `)}
        ${state.assetDownload.active ? renderAssetDownloadPanel() : ''}
        <div class="metrics-grid">
            ${metricCard('背景', formatNumber(allBackgrounds.length), '背景图片', 'fa-image')}
            ${metricCard('资产文件', formatNumber(getAssetCount()), 'assets 目录', 'fa-folder-tree')}
            ${metricCard('背景文件夹', formatNumber(backgroundFolders.length), folderFilterName, 'fa-folder')}
            ${metricCard('动画背景', formatNumber(allBackgrounds.filter(item => item.isAnimated).length), 'metadata 标记', 'fa-film')}
        </div>
        ${renderAssetTabs(assetTab, backgrounds.length, getAssetCount())}
        ${assetTab === 'backgrounds' ? `
            ${renderBackgroundFoldersPanel(backgroundFolders, folderCounts, selectedCount)}
            ${renderBackgroundLibraryPanel(folderFilterName, visibleBackgrounds, backgrounds.length, selectedCount, selection, hasMoreBackgrounds)}
        ` : `
            <div class="grid-list">
                ${groups.map(group => renderAssetGroupCard(group)).join('') || renderEmptyState('fa-folder-tree', '暂无素材', '当前资产目录还没有可显示文件。')}
            </div>
        `}
    `;
    }

    function renderAssetTabs(assetTab, backgroundCount, assetCount) {
        return `
        <div class="segmented-control asset-tabs" role="tablist" aria-label="素材类型">
            <button class="${assetTab === 'backgrounds' ? 'active' : ''}" type="button" data-asset-tab="backgrounds" aria-selected="${assetTab === 'backgrounds'}">
                <i class="fa-solid fa-image"></i>
                背景
                <span class="badge">${formatNumber(backgroundCount)}</span>
            </button>
            <button class="${assetTab === 'files' ? 'active' : ''}" type="button" data-asset-tab="files" aria-selected="${assetTab === 'files'}">
                <i class="fa-solid fa-folder-tree"></i>
                文件资产
                <span class="badge">${formatNumber(assetCount)}</span>
            </button>
        </div>
    `;
    }

    function renderAssetGroupCard(group) {
        const expanded = state.assetExpandedGroups.includes(group.name);
        const entries = getAssetEntries(group, expanded ? Infinity : 8)
            .sort((a, b) => Number(getAssetId(b) === state.selected.asset) - Number(getAssetId(a) === state.selected.asset));
        const hiddenCount = Math.max(group.count - entries.length, 0);

        return `
        <article class="resource-card">
            <div class="card-head">
                <div>
                    <h2 class="card-title">${escapeHtml(group.name)}</h2>
                    <div class="card-meta">${formatNumber(group.count)} 个文件</div>
                </div>
                <span class="badge">${formatNumber(group.count)}</span>
            </div>
            <div class="resource-list compact-list">
                ${entries.map(entry => renderAssetEntryRow(entry)).join('') || renderInlineEmpty('空分类')}
            </div>
            ${group.count > 8 ? `
                <button class="secondary-button load-more-button" type="button" data-toggle-asset-group="${escapeHtml(group.name)}">
                    <i class="fa-solid ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>
                    ${expanded ? '收起资产' : `展开全部 ${formatNumber(hiddenCount)}`}
                </button>
            ` : ''}
        </article>
    `;
    }

    function renderAssetDownloadPanel() {
        const download = state.assetDownload;
        const categories = [
            { value: 'bgm', label: 'BGM' },
            { value: 'ambient', label: '环境音' },
            { value: 'blip', label: '提示音' },
        ];

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">下载资产</h2>
                    <p class="panel-subtitle">把白名单域名下的文件下载到 assets 分类目录。</p>
                </div>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>资产 URL</span>
                        <input class="text-input" type="url" data-asset-download-url value="${escapeHtml(download.url)}" placeholder="https://example.com/file.mp3" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>文件名</span>
                        <input class="text-input" type="text" data-asset-download-filename value="${escapeHtml(download.filename)}" placeholder="sound.mp3" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>分类</span>
                        <select class="select-input" data-asset-download-category>
                            ${categories.map(category => `<option value="${category.value}" ${download.category === category.value ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-toggle-asset-download ${download.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-download-asset ${download.running ? 'disabled' : ''}>
                        <i class="fa-solid ${download.running ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-down'}"></i>
                        ${download.running ? '下载中' : '下载'}
                    </button>
                </div>
            </div>
        </section>
    `;
    }

    function renderAssetEntryRow(entry) {
        const assetId = getAssetId(entry);
        const isSelected = state.selected.asset === assetId;
        const isDeleting = state.assetDeleteConfirm.category === entry.category && state.assetDeleteConfirm.filename === entry.filename;
        const isBusy = isDeleting && state.assetDeleteConfirm.running;
        const readOnlyReason = entry.filename?.includes('/')
            ? '嵌套资源需在资源目录管理'
            : '当前分类不支持删除';

        return `
        <div class="resource-row asset-row ${isSelected ? 'selected' : ''}" data-asset-row="${escapeHtml(assetId)}">
            <span class="avatar-fallback"><i class="fa-solid fa-file"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(entry.label || entry.filename)}</span>
                <span class="row-subtitle">${escapeHtml(entry.path)}</span>
            </span>
            ${entry.deletable ? `
                <span class="row-actions">
                    ${isDeleting ? `
                        <button class="secondary-button" type="button" data-cancel-asset-delete ${isBusy ? 'disabled' : ''}>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-asset-delete ${isBusy ? 'disabled' : ''}>
                            <i class="fa-solid ${isBusy ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            确认
                        </button>
                    ` : `
                        <button class="secondary-button" type="button" data-delete-asset data-asset-category="${escapeHtml(entry.category)}" data-asset-filename="${escapeHtml(entry.filename)}">
                            <i class="fa-solid fa-ellipsis"></i>
                            管理
                        </button>
                    `}
                </span>
            ` : `<span class="card-meta asset-readonly">${escapeHtml(readOnlyReason)}</span>`}
        </div>
    `;
    }

    function getAssetId(entry) {
        return `${entry.category}:${entry.path}`;
    }

    function getSelectedAssetCategory(assetId) {
        return String(assetId || '').split(':')[0] || '';
    }

    return {
        renderAssets,
    };
}

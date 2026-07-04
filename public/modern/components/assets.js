import { createAssetBackgroundComponents } from './assets-backgrounds.js';
import { createAssetFileComponents } from './assets-files.js';

export function createAssetsComponents(ctx) {
    const {
        state,
        formatNumber,
        metricCard,
        pageHead,
        renderRouteFilter,
        matchesQuery,
        getAssetCount,
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
    const {
        renderAssetDownloadPanel,
        renderAssetFilesPanel,
    } = createAssetFileComponents(ctx);

    function renderAssets() {
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
        <div class="route-filter-strip">
            ${renderRouteFilter('筛选素材', assetTab === 'backgrounds' ? '背景文件名' : '资产分类名')}
        </div>
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
            ${renderAssetFilesPanel()}
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

    return {
        renderAssets,
    };
}

import { formatNumber } from '../core/utils.js';

export function createInspectorAssetSection({
    state,
    renderSection,
}) {
    function getAssetFileCount() {
        return Object.values(state.assets || {}).reduce((total, entries) => total + (Array.isArray(entries) ? entries.length : 0), 0);
    }

    function getBackgroundFilename(background) {
        return typeof background === 'string' ? background : background?.filename || '';
    }

    function getSelectedBackgroundName() {
        const selected = state.selected.background;
        if (!selected) {
            return '未选中';
        }
        const match = (state.backgrounds?.images || []).find(background => getBackgroundFilename(background) === selected);
        return getBackgroundFilename(match) || selected;
    }

    function getSelectedAssetName() {
        const selected = state.selected.asset || '';
        const separatorIndex = selected.indexOf(':');
        if (separatorIndex < 0) {
            return '未选中';
        }

        const category = selected.slice(0, separatorIndex);
        const selectedPath = selected.slice(separatorIndex + 1);
        const entries = getAssetEntriesForCategory(category);
        const match = entries.find(entry => entry.path === selectedPath);
        return match?.label || match?.filename || selectedPath.split('/').filter(Boolean).pop() || selectedPath || '未选中';
    }

    function getAssetEntriesForCategory(category) {
        const value = state.assets?.[category];
        const entries = [];
        if (Array.isArray(value)) {
            value.forEach(path => entries.push(formatAssetEntry(path)));
        } else if (value && typeof value === 'object') {
            Object.entries(value).forEach(([section, items]) => {
                if (!Array.isArray(items)) {
                    return;
                }
                items.forEach(path => entries.push(formatAssetEntry(path, section)));
            });
        }
        return entries;
    }

    function formatAssetEntry(path, section = '') {
        const filename = String(path || '').split('/').filter(Boolean).pop() || '';
        return {
            path,
            filename,
            label: section ? `${section}/${filename}` : filename,
        };
    }

    function getBackgroundCount() {
        return Array.isArray(state.backgrounds?.images) ? state.backgrounds.images.length : 0;
    }

    function getBackgroundFolderCount() {
        return Array.isArray(state.backgroundFolders?.folders) ? state.backgroundFolders.folders.length : 0;
    }

    function renderAssetContextSection() {
        return renderSection('素材状态', [
            ['当前视图', state.assetTab === 'files' ? '资产文件' : '背景'],
            ['背景数量', `${formatNumber(getBackgroundCount())} 个`],
            ['资产文件', `${formatNumber(getAssetFileCount())} 个`],
            ['背景文件夹', `${formatNumber(getBackgroundFolderCount())} 个`],
            ['当前背景', getSelectedBackgroundName()],
            ['当前资产', getSelectedAssetName()],
            ['文件夹筛选', state.backgroundFolderFilter || '全部背景'],
            ['选择模式', state.backgroundSelection.active ? '已开启' : '未开启'],
            ['选中背景', `${formatNumber(state.backgroundSelection.filenames.length)} 个`],
        ]);
    }

    return {
        getAssetFileCount,
        getBackgroundCount,
        renderAssetContextSection,
    };
}

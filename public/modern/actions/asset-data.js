export function createAssetDataHelpers({ state }) {
    function getAssetGroups() {
        return Object.entries(state.assets || {}).map(([name, value]) => {
            if (Array.isArray(value)) {
                return { name, count: value.length, detail: value };
            }

            if (value && typeof value === 'object') {
                const count = Object.values(value).reduce((total, item) => total + (Array.isArray(item) ? item.length : 0), 0);
                return { name, count, detail: value };
            }

            return { name, count: 0, detail: value };
        });
    }

    function getAssetCount() {
        return getAssetGroups().reduce((total, group) => total + group.count, 0);
    }

    function getAssetFileName(assetPath) {
        return String(assetPath || '').split('/').filter(Boolean).pop() || '';
    }

    function getAssetRelativeName(category, assetPath) {
        const value = String(assetPath || '');
        const prefix = `assets/${category}/`;
        return value.startsWith(prefix) ? value.slice(prefix.length) : getAssetFileName(value);
    }

    function canDeleteAsset(category, assetPath) {
        const relativeName = getAssetRelativeName(category, assetPath);
        return ['bgm', 'ambient', 'blip'].includes(category) && relativeName && !relativeName.includes('/');
    }

    function getAssetEntries(group, limit = Infinity) {
        const entries = [];
        if (Array.isArray(group.detail)) {
            group.detail.forEach(assetPath => {
                entries.push({
                    category: group.name,
                    filename: getAssetRelativeName(group.name, assetPath),
                    path: assetPath,
                    label: getAssetFileName(assetPath),
                    deletable: canDeleteAsset(group.name, assetPath),
                });
            });
        } else if (group.detail && typeof group.detail === 'object') {
            Object.entries(group.detail).forEach(([section, items]) => {
                if (!Array.isArray(items)) {
                    return;
                }
                items.forEach(assetPath => {
                    entries.push({
                        category: group.name,
                        filename: getAssetRelativeName(group.name, assetPath),
                        path: assetPath,
                        label: `${section}/${getAssetFileName(assetPath)}`,
                        deletable: canDeleteAsset(group.name, assetPath),
                    });
                });
            });
        }

        return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
    }

    function getBackgroundUrl(filename) {
        return `/backgrounds/${String(filename || '').split('/').map(part => encodeURIComponent(part)).join('/')}`;
    }

    function getBackgroundFilename(background) {
        return typeof background === 'string' ? background : background?.filename || '';
    }

    function getBackgroundFolderData() {
        return {
            folders: Array.isArray(state.backgroundFolders?.folders) ? state.backgroundFolders.folders : [],
            imageFolderMap: state.backgroundFolders?.imageFolderMap || {},
        };
    }

    function getBackgroundFolderById(folderId) {
        return getBackgroundFolderData().folders.find(folder => folder.id === folderId) || null;
    }

    function getBackgroundFolderIds(filename) {
        const map = getBackgroundFolderData().imageFolderMap;
        return Array.isArray(map[filename]) ? map[filename] : [];
    }

    function getBackgroundFoldersFor(filename) {
        return getBackgroundFolderIds(filename).map(getBackgroundFolderById).filter(Boolean);
    }

    function getBackgroundFolderCounts() {
        const counts = {};
        for (const folder of getBackgroundFolderData().folders) {
            counts[folder.id] = 0;
        }
        for (const folderIds of Object.values(getBackgroundFolderData().imageFolderMap)) {
            for (const folderId of new Set(Array.isArray(folderIds) ? folderIds : [])) {
                counts[folderId] = (counts[folderId] || 0) + 1;
            }
        }
        return counts;
    }

    return {
        getAssetCount,
        getAssetEntries,
        getAssetGroups,
        getBackgroundFilename,
        getBackgroundFolderById,
        getBackgroundFolderCounts,
        getBackgroundFolderData,
        getBackgroundFolderIds,
        getBackgroundFoldersFor,
        getBackgroundUrl,
    };
}

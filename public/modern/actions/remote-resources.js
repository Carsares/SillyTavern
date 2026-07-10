import { downloadFile } from '../core/utils.js';

const remoteResourceTypes = new Set(['', 'character', 'worldbook', 'extension', 'asset', 'preset']);

export function createRemoteResourceActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    callLegacyBridge,
    loadWorldDetail,
    confirmAction = message => window.confirm(message),
}) {
    function getRemoteResourceCount() {
        return state.remoteResources.records.length;
    }

    async function loadRemoteResources({ force = false } = {}) {
        if (!force && state.remoteResources.loaded) {
            return;
        }

        state.remoteResources.loading = true;
        render();
        try {
            const [providers, records] = await Promise.all([
                apiFetch('/api/remote-resources/providers', { method: 'GET' }),
                apiFetch('/api/remote-resources/records', { method: 'GET' }),
            ]);
            state.remoteResources.providers = Array.isArray(providers) ? providers : [];
            state.remoteResources.records = Array.isArray(records) ? records : [];
            if (!state.remoteResources.selectedProviders.length) {
                state.remoteResources.selectedProviders = state.remoteResources.providers
                    .filter(provider => provider.supportsSearch)
                    .map(provider => provider.id);
            }
            state.remoteResources.loaded = true;
        } finally {
            state.remoteResources.loading = false;
            render();
        }
    }

    async function refreshRemoteResources() {
        await loadRemoteResources({ force: true });
        showToast('远程资源已刷新', '资源站与导入记录已更新');
    }

    function setRemoteResourceTab(tab) {
        state.remoteResources.activeTab = ['discover', 'url', 'records', 'accounts'].includes(tab) ? tab : 'discover';
        localStorage.setItem('st-modern-remote-resource-tab', state.remoteResources.activeTab);
        render();
    }

    function setRemoteResourceType(resourceType) {
        state.remoteResources.resourceType = remoteResourceTypes.has(resourceType) ? resourceType : '';
        render();
    }

    function setRemoteResourceQuery(query) {
        state.remoteResources.query = query;
    }

    function setRemoteUrlImport(url) {
        state.remoteResources.urlImport.url = url;
    }

    function toggleRemoteProvider(providerId, checked) {
        const providers = new Set(state.remoteResources.selectedProviders);
        if (checked) {
            providers.add(providerId);
        } else {
            providers.delete(providerId);
        }
        state.remoteResources.selectedProviders = [...providers];
        render();
    }

    async function searchRemoteResources() {
        if (!state.remoteResources.loaded) {
            await loadRemoteResources();
        }
        const providers = state.remoteResources.selectedProviders.length
            ? state.remoteResources.selectedProviders
            : state.remoteResources.providers.filter(provider => provider.supportsSearch).map(provider => provider.id);

        state.remoteResources.searching = true;
        state.remoteResources.searched = true;
        state.remoteResources.errors = [];
        render();
        try {
            const result = await apiFetch('/api/remote-resources/search', {
                body: {
                    query: state.remoteResources.query.trim(),
                    resourceType: state.remoteResources.resourceType,
                    providers,
                    page: 1,
                    limit: 48,
                },
            });
            state.remoteResources.results = Array.isArray(result?.items) ? result.items : [];
            state.remoteResources.total = Number(result?.total) || state.remoteResources.results.length;
            state.remoteResources.errors = Array.isArray(result?.errors) ? result.errors : [];
            if (state.remoteResources.errors.length) {
                showToast('部分资源站读取失败', state.remoteResources.errors[0]);
            }
        } finally {
            state.remoteResources.searching = false;
            render();
        }
    }

    async function importRemoteUrl() {
        const url = state.remoteResources.urlImport.url.trim();
        if (!url) {
            throw new Error('请输入远程资源 URL。');
        }
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('远程资源 URL 只支持 HTTP 或 HTTPS。');
        }

        state.remoteResources.urlImport.running = true;
        render();
        try {
            const response = await apiFetchResponse('/api/content/importURL', { body: { url } });
            const resourceType = response.headers.get('x-custom-content-type') === 'lorebook' ? 'worldbook' : response.headers.get('x-custom-content-type') || 'character';
            const blob = await response.blob();
            const fileName = getResponseFileName(response) || getFileNameFromUrl(url, resourceType === 'worldbook' ? 'remote-worldbook.json' : 'remote-character.png');
            const localId = await importBlobAsLocalResource(blob, fileName, resourceType);
            await saveRemoteRecord({
                providerId: getUrlProviderId(parsedUrl.hostname),
                providerName: parsedUrl.hostname,
                remoteId: url,
                resourceType,
                title: fileName.replace(/\.[^/.]+$/, ''),
                sourceUrl: url,
                localType: resourceType,
                localId,
                action: 'import-url',
            });
            state.remoteResources.urlImport = { url: '', running: false };
            showToast(resourceType === 'worldbook' ? '世界书已导入' : '角色已导入', localId || fileName);
        } finally {
            state.remoteResources.urlImport.running = false;
            render();
        }
    }

    async function importRemoteResource(index) {
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }

        if (item.resourceType === 'extension') {
            await installRemoteExtension(item);
            return;
        }

        if (item.resourceType === 'asset') {
            await downloadRemoteAsset(item);
            return;
        }

        if (!['character', 'worldbook'].includes(item.resourceType)) {
            await downloadRemoteResource(index);
            return;
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const response = await apiFetchResponse('/api/remote-resources/download', {
                body: {
                    providerId: item.providerId,
                    resourceId: item.id,
                    resourceType: item.resourceType,
                },
            });
            const blob = await response.blob();
            const fileName = getResponseFileName(response) || `${item.title || item.id}.json`;
            const localId = await importBlobAsLocalResource(blob, fileName, item.resourceType);
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: item.resourceType,
                localId,
                action: 'import',
                metadata: item.metadata,
            });
            showToast(item.resourceType === 'worldbook' ? '世界书已导入' : '角色已导入', localId || item.title);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function downloadRemoteResource(index) {
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }
        if (!item.capabilities?.download) {
            throw new Error('该资源没有可下载文件。');
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const response = await apiFetchResponse('/api/remote-resources/download', {
                body: {
                    providerId: item.providerId,
                    resourceId: item.id,
                    resourceType: item.resourceType,
                },
            });
            const blob = await response.blob();
            const fileName = getResponseFileName(response) || getFileNameFromUrl(item.downloadUrl || item.sourceUrl, `${item.id}.json`);
            downloadFile(blob, fileName, blob.type || 'application/octet-stream');
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: '',
                localId: fileName,
                action: 'download',
                metadata: item.metadata,
            });
            showToast('下载已开始', fileName);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function downloadRemoteAsset(item) {
        const category = item.metadata?.assetCategory || 'ambient';
        const filename = item.metadata?.filename || getFileNameFromUrl(item.downloadUrl, `${item.id}.bin`);
        if (!item.downloadUrl) {
            throw new Error('该素材没有下载 URL。');
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            await apiFetch('/api/assets/download', {
                body: {
                    url: item.downloadUrl,
                    category,
                    filename,
                },
            });
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: 'asset',
                localId: `${category}/${filename}`,
                action: 'download',
                metadata: item.metadata,
            });
            await loadData({ silent: true });
            showToast('素材已下载', `${category}/${filename}`);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function installRemoteExtension(item) {
        const installUrl = item.installUrl || item.sourceUrl;
        if (!installUrl) {
            throw new Error('该扩展没有 Git URL。');
        }
        const parsedUrl = new URL(installUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('扩展 URL 只支持 HTTP 或 HTTPS。');
        }
        if (!isOfficialExtensionUrl(parsedUrl.href) && !confirmAction('即将安装第三方扩展。第三方扩展可以运行前端代码，请确认你信任该来源。')) {
            throw new Error('已取消扩展安装。');
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const result = await apiFetch('/api/extensions/install', {
                body: {
                    url: parsedUrl.href,
                    branch: '',
                    global: false,
                },
            });
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: 'extension',
                localId: result?.folderName || item.title,
                action: 'install',
                metadata: item.metadata,
            });
            await loadData({ silent: true });
            showToast('扩展已安装', result?.display_name || result?.folderName || item.title);
            try {
                await callLegacyBridge('extensionInstalled', { response: result }, 60000);
            } catch (error) {
                showToast('扩展已安装，请刷新页面完成初始化', error.message);
            }
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function saveRemoteProviderCredential(providerId, credentialId, value) {
        if (!value.trim()) {
            throw new Error('请输入凭据内容。');
        }
        state.remoteResources.credentialSaving = `${providerId}:${credentialId}`;
        render();
        try {
            const result = await apiFetch('/api/remote-resources/credentials', {
                body: { providerId, credentialId, value },
            });
            state.remoteResources.providers = Array.isArray(result?.providers) ? result.providers : state.remoteResources.providers;
            state.remoteResources.credentialDrafts[`${providerId}:${credentialId}`] = '';
            showToast('资源站凭据已保存', providerId);
        } finally {
            state.remoteResources.credentialSaving = '';
            render();
        }
    }

    async function deleteRemoteProviderCredential(providerId, credentialId) {
        state.remoteResources.credentialSaving = `${providerId}:${credentialId}`;
        render();
        try {
            const result = await apiFetch('/api/remote-resources/credentials', {
                method: 'DELETE',
                body: { providerId, credentialId },
            });
            state.remoteResources.providers = Array.isArray(result?.providers) ? result.providers : state.remoteResources.providers;
            showToast('资源站凭据已删除', providerId);
        } finally {
            state.remoteResources.credentialSaving = '';
            render();
        }
    }

    function setRemoteCredentialDraft(providerId, credentialId, value) {
        state.remoteResources.credentialDrafts[`${providerId}:${credentialId}`] = value;
    }

    async function deleteRemoteRecord(id) {
        await apiFetch(`/api/remote-resources/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.remoteResources.records = state.remoteResources.records.filter(record => record.id !== id);
        showToast('导入记录已删除', '');
        render();
    }

    async function saveRemoteRecord(record) {
        const saved = await apiFetch('/api/remote-resources/records', { body: record });
        if (saved) {
            state.remoteResources.records = [saved, ...state.remoteResources.records.filter(item => item.id !== saved.id)];
        }
    }

    async function importBlobAsLocalResource(blob, fileName, resourceType) {
        if (resourceType === 'worldbook') {
            const importFileName = ensureExtension(fileName, 'json');
            const worldName = importFileName.replace(/\.json$/i, '');
            async function importWorldbook(shouldOverwrite) {
                const formData = new FormData();
                formData.append('avatar', new File([blob], importFileName, { type: blob.type || 'application/json' }));
                if (shouldOverwrite) {
                    formData.set('overwrite', 'true');
                }
                return apiFetch('/api/worldinfo/import', { body: formData, omitContentType: true });
            }

            function confirmWorldbookOverwrite(name) {
                if (!confirmAction(`同名世界书“${name}”已存在，继续导入将覆盖现有内容。是否继续？`)) {
                    throw new Error('已取消世界书覆盖。');
                }
                return true;
            }

            const knownWorldNames = new Set([
                ...(state.worldbooks || []).map(worldbook => worldbook.file_id),
                ...(state.settingsBundle?.world_names || []),
            ]);
            // Worldbook imports are non-destructive unless the user explicitly confirms replacement.
            let overwrite = false;
            if (knownWorldNames.has(worldName)) {
                overwrite = confirmWorldbookOverwrite(worldName);
            }

            let result;
            try {
                result = await importWorldbook(overwrite);
            } catch (error) {
                if (error?.status !== 409 || overwrite) {
                    throw error;
                }
                result = await importWorldbook(confirmWorldbookOverwrite(worldName));
            }

            const importedName = result?.name || worldName;
            state.selected.worldbook = importedName;
            delete state.worldDetails[importedName];
            await loadData({ silent: true });
            await loadWorldDetail(importedName);
            return importedName;
        }

        const extension = getFileExtension(fileName) || (blob.type === 'image/png' ? 'png' : 'json');
        const formData = new FormData();
        formData.set('avatar', new File([blob], ensureExtension(fileName, extension), { type: blob.type || 'application/octet-stream' }));
        formData.set('file_type', extension);
        const result = await apiFetch('/api/characters/import', { body: formData, omitContentType: true });
        if (result?.error) {
            throw new Error('角色卡导入失败。');
        }
        const avatar = result?.file_name ? String(result.file_name).replace(/\.png$/i, '') + '.png' : '';
        if (avatar) {
            state.selected.character = avatar;
            state.selected.chat = '';
        }
        await loadData({ silent: true });
        return avatar || fileName;
    }

    return {
        deleteRemoteProviderCredential,
        deleteRemoteRecord,
        downloadRemoteResource,
        getRemoteResourceCount,
        importRemoteResource,
        importRemoteUrl,
        loadRemoteResources,
        refreshRemoteResources,
        saveRemoteProviderCredential,
        searchRemoteResources,
        setRemoteCredentialDraft,
        setRemoteResourceQuery,
        setRemoteResourceTab,
        setRemoteResourceType,
        setRemoteUrlImport,
        toggleRemoteProvider,
    };
}

function itemKey(item) {
    return `${item.providerId}:${item.resourceType}:${item.id}`;
}

function isOfficialExtensionUrl(url) {
    try {
        return /^https:\/\/github\.com\/SillyTavern\/(.+)$/i.test(new URL(url).href);
    } catch {
        return false;
    }
}

function getResponseFileName(response) {
    const disposition = response.headers.get('content-disposition') || '';
    const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utfMatch) {
        return decodeURIComponent(utfMatch[1]);
    }
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return match ? decodeURIComponent(match[1]) : '';
}

function getFileNameFromUrl(url, fallback) {
    try {
        return new URL(url).pathname.split('/').pop() || fallback;
    } catch {
        return fallback;
    }
}

function getUrlProviderId(hostname) {
    if (hostname.includes('chub.ai') || hostname.includes('characterhub.org')) {
        return 'chub';
    }
    if (hostname.includes('risuai.net')) {
        return 'risu-realm';
    }
    return 'url';
}

function getFileExtension(fileName) {
    return fileName.split('.').pop()?.toLowerCase() || '';
}

function ensureExtension(fileName, extension) {
    if (fileName.toLowerCase().endsWith(`.${extension}`)) {
        return fileName;
    }
    return `${fileName.replace(/\.[^/.]+$/, '')}.${extension}`;
}

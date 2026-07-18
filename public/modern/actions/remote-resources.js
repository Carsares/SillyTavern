import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';
import { downloadFile } from '../core/utils.js';

const remoteResourceTypes = new Set(['', 'character', 'worldbook', 'extension', 'asset', 'preset']);

// 后端 /api/presets/save 认可的 apiId 集合，非该集合的值会被后端拒绝。
const presetApiIds = new Set(['kobold', 'koboldhorde', 'novel', 'textgenerationwebui', 'openai', 'instruct', 'context', 'sysprompt', 'reasoning']);

// 仅在强信号命中时返回具体 apiId，弱信号或无判据一律返回 null，交给用户在卡片内联选择，避免误判。
function inferPresetApiId(preset) {
    if (!preset || typeof preset !== 'object') {
        return null;
    }
    const has = key => Object.prototype.hasOwnProperty.call(preset, key);
    // openai：Chat Completion 专有字段，或同时具备提示词编排结构
    if (has('chat_completion_source') || has('openai_model') || (has('prompts') && has('prompt_order'))) {
        return 'openai';
    }
    // textgenerationwebui：文本补全采样字段（已排除 openai 信号）
    if (has('sampler_order') || has('dynatemp') || has('max_tokens_second') || has('rep_pen')) {
        return 'textgenerationwebui';
    }
    // instruct：指令模板同时含输入与输出序列
    if (has('input_sequence') && has('output_sequence')) {
        return 'instruct';
    }
    // context：上下文模板同时含 story_string 与 chat_start
    if (has('story_string') && has('chat_start')) {
        return 'context';
    }
    // 其余（sysprompt/novel/kobold/reasoning 等弱信号）交给用户选择
    return null;
}

export function createRemoteResourceActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    callLegacyBridge,
    loadWorldDetail,
    ensureWorldbookFileWriteAllowed,
    restoreWorldbookFile,
    confirmAction = message => window.confirm(message),
}) {
    let remoteSearchToken = null;

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
        const searchToken = Symbol('remote-search');
        remoteSearchToken = searchToken;
        const query = state.remoteResources.query.trim();
        const resourceType = state.remoteResources.resourceType;
        const selectedProviders = [...state.remoteResources.selectedProviders];
        try {
            if (!state.remoteResources.loaded) {
                await loadRemoteResources();
            }
            if (remoteSearchToken !== searchToken) {
                return;
            }

            const providers = selectedProviders.length
                ? selectedProviders
                : state.remoteResources.providers.filter(provider => provider.supportsSearch).map(provider => provider.id);
            state.remoteResources.searching = true;
            state.remoteResources.searched = true;
            state.remoteResources.errors = [];
            render();
            const result = await apiFetch('/api/remote-resources/search', {
                body: {
                    query,
                    resourceType,
                    providers,
                    page: 1,
                    limit: 48,
                },
            });
            if (remoteSearchToken !== searchToken) {
                return;
            }
            state.remoteResources.results = Array.isArray(result?.items) ? result.items : [];
            state.remoteResources.total = Number(result?.total) || state.remoteResources.results.length;
            state.remoteResources.errors = Array.isArray(result?.errors) ? result.errors : [];
            if (state.remoteResources.errors.length) {
                showToast('部分资源站读取失败', state.remoteResources.errors[0]);
            }
        } catch (error) {
            if (remoteSearchToken === searchToken) {
                throw error;
            }
        } finally {
            if (remoteSearchToken === searchToken) {
                state.remoteResources.searching = false;
                render();
            }
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

        if (item.resourceType === 'preset') {
            await importRemotePreset(index);
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

    // 远程预设导入：先按字段特征自动推断 apiId，推不出再让用户在卡片内联选择类型。
    async function importRemotePreset(index) {
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }

        // RisuAI 的预设是 preset-risu-v1 专有格式，非 ST 原生，直接提示不支持，不落盘。
        if (item.providerId === 'risu-realm') {
            showToast('暂不支持导入', '该来源为 RisuAI 专有格式');
            return;
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const preset = await downloadRemotePreset(item);
            const apiId = inferPresetApiId(preset);
            if (!apiId) {
                // 推断不出类型时记录待选状态，卡片会渲染内联 select 让用户选，本轮不落盘。
                state.remoteResources.presetPrompt = { key: itemKey(item), index };
                return;
            }
            await savePresetImport(item, preset, apiId);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    // 用户在内联 select 选定类型后确认导入的入口。
    async function importPresetWithType(index, apiId) {
        if (!presetApiIds.has(apiId)) {
            throw new Error('请选择有效的预设类型。');
        }
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }

        state.remoteResources.presetPrompt = null;
        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const preset = await downloadRemotePreset(item);
            await savePresetImport(item, preset, apiId);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    function cancelPresetImport() {
        state.remoteResources.presetPrompt = null;
        render();
    }

    async function downloadRemotePreset(item) {
        const response = await apiFetchResponse('/api/remote-resources/download', {
            body: {
                providerId: item.providerId,
                resourceId: item.id,
                resourceType: item.resourceType,
            },
        });
        const blob = await response.blob();
        const text = await blob.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error('预设文件解析失败，返回内容不是有效 JSON。');
        }
    }

    async function savePresetImport(item, preset, apiId) {
        const name = (item.title || item.id || 'preset').trim();
        const saved = await apiFetch('/api/presets/save', { body: { name, preset, apiId } });
        const savedName = saved?.name || name;
        await saveRemoteRecord({
            providerId: item.providerId,
            providerName: item.providerName,
            remoteId: item.id,
            resourceType: item.resourceType,
            title: item.title,
            sourceUrl: item.sourceUrl,
            localType: 'preset',
            localId: savedName,
            action: 'import',
            metadata: item.metadata,
        });
        showToast('预设已导入', savedName);
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
                await callLegacyBridge(BRIDGE_ACTIONS.EXTENSION_INSTALLED, { response: result }, BRIDGE_TIMEOUTS.EXTENSION);
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

    // Persist a per-provider enabled preference so a broken resource site can be disabled globally.
    async function toggleProviderEnabled(providerId, enabled) {
        state.remoteResources.providerToggling = providerId;
        render();
        try {
            const result = await apiFetch('/api/remote-resources/providers/preferences', {
                body: { providerId, enabled },
            });
            state.remoteResources.providers = Array.isArray(result?.providers) ? result.providers : state.remoteResources.providers;
            showToast(enabled ? '资源站已启用' : '资源站已禁用', providerId);
        } finally {
            state.remoteResources.providerToggling = '';
            render();
        }
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
            const sanitizedFileName = await apiFetch('/api/files/sanitize-filename', { body: { fileName: importFileName } });
            const worldName = typeof sanitizedFileName?.fileName === 'string' ? sanitizedFileName.fileName.replace(/\.json$/i, '') : '';
            if (!worldName) {
                throw new Error('世界书文件名清理后为空，请使用其他文件名。');
            }
            async function importWorldbook(shouldOverwrite) {
                ensureWorldbookFileWriteAllowed(worldName);
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
            restoreWorldbookFile(importedName);
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
        cancelPresetImport,
        deleteRemoteProviderCredential,
        deleteRemoteRecord,
        downloadRemoteResource,
        getRemoteResourceCount,
        importPresetWithType,
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
        toggleProviderEnabled,
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

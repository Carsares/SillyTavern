import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';

export function createExtensionActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    callLegacyBridge,
}) {
    function getExtensionFolderName(extension) {
        return String(extension?.name || '').replace(/^third-party\//, '');
    }

    function canManageExtension(extension) {
        return extension?.type === 'local' || (extension?.type === 'global' && state.me?.admin);
    }

    function isOfficialExtensionUrl(url) {
        try {
            return /^https:\/\/github\.com\/SillyTavern\/(.+)$/i.test(new URL(url).href);
        } catch {
            return false;
        }
    }

    function resetExtensionDetails() {
        state.extensionDetails = { name: '', type: '', loading: false, version: null, branches: [], branch: '', error: '' };
    }

    function toggleExtensionInstall(active = !state.extensionInstall.active) {
        state.extensionInstall = {
            active,
            url: active ? state.extensionInstall.url : '',
            urlError: '',
            branch: active ? state.extensionInstall.branch : '',
            global: active ? state.extensionInstall.global : false,
            running: false,
        };
        render();
    }

    function showExtensionInstallUrlError(message) {
        state.extensionInstall.urlError = message;
        showToast('扩展安装失败', message);
        render();
        window.setTimeout(() => {
            document.querySelector('[data-extension-install-url]')?.focus();
        }, 0);
    }

    async function installExtensionFromForm() {
        const url = state.extensionInstall.url.trim();
        const branch = state.extensionInstall.branch.trim();
        if (!url) {
            showExtensionInstallUrlError('请输入扩展 Git URL。');
            return;
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            showExtensionInstallUrlError('请输入有效的扩展 Git URL。');
            return;
        }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            showExtensionInstallUrlError('扩展 URL 只支持 HTTP 或 HTTPS。');
            return;
        }
        if (!isOfficialExtensionUrl(parsedUrl.href) && !window.confirm('即将安装第三方扩展。第三方扩展可以运行前端代码，请确认你信任该来源。')) {
            throw new Error('已取消扩展安装。');
        }

        state.extensionInstall.urlError = '';
        state.extensionInstall.running = true;
        render();
        try {
            const result = await apiFetch('/api/extensions/install', {
                body: {
                    url: parsedUrl.href,
                    branch,
                    global: Boolean(state.extensionInstall.global && state.me?.admin),
                },
            });
            state.extensionInstall = { active: false, url: '', urlError: '', branch: '', global: false, running: false };
            resetExtensionDetails();
            await loadData({ silent: true });
            showToast('扩展已安装', result?.display_name || result?.folderName || parsedUrl.pathname.split('/').pop());
            try {
                await callLegacyBridge(BRIDGE_ACTIONS.EXTENSION_INSTALLED, { response: result }, BRIDGE_TIMEOUTS.EXTENSION);
            } catch (error) {
                showToast('扩展已安装，请刷新页面完成初始化', error.message);
            }
        } finally {
            state.extensionInstall.running = false;
            render();
        }
    }

    function beginExtensionOperation(name, type, action) {
        state.extensionOperation = { name, type, action, running: false };
        render();
    }

    function cancelExtensionOperation() {
        state.extensionOperation = { name: '', type: '', action: '', running: false };
        render();
    }

    async function confirmExtensionOperation() {
        const { name, type, action } = state.extensionOperation;
        if (!name || !action) {
            throw new Error('请选择扩展操作。');
        }

        state.extensionOperation.running = true;
        render();
        const body = { extensionName: name, global: type === 'global' };
        if (action === 'update') {
            const result = await apiFetch('/api/extensions/update', { body });
            showToast(result?.isUpToDate ? '扩展已是最新' : '扩展已更新', result?.shortCommitHash || name);
        } else if (action === 'delete') {
            await apiFetch('/api/extensions/delete', { body });
            showToast('扩展已删除', name);
        } else if (action === 'move') {
            const destination = type === 'global' ? 'local' : 'global';
            await apiFetch('/api/extensions/move', { body: { extensionName: name, source: type, destination } });
            showToast('扩展位置已移动', `${name} → ${destination}`);
        } else {
            throw new Error('未知扩展操作。');
        }
        state.extensionOperation = { name: '', type: '', action: '', running: false };
        resetExtensionDetails();
        await loadData({ silent: true });
        render();
    }

    async function loadExtensionDetails(name, type, { branches = false } = {}) {
        if (!name || !type) {
            throw new Error('请选择扩展。');
        }

        state.extensionDetails = {
            name,
            type,
            loading: true,
            version: state.extensionDetails.name === name && state.extensionDetails.type === type ? state.extensionDetails.version : null,
            branches: state.extensionDetails.name === name && state.extensionDetails.type === type ? state.extensionDetails.branches : [],
            branch: state.extensionDetails.name === name && state.extensionDetails.type === type ? state.extensionDetails.branch : '',
            error: '',
        };
        render();

        try {
            const body = { extensionName: name, global: type === 'global' };
            const version = await apiFetch('/api/extensions/version', { body });
            let extensionBranches = state.extensionDetails.branches;
            if (branches) {
                const result = await apiFetch('/api/extensions/branches', { body });
                extensionBranches = Array.isArray(result) ? result : [];
            }

            state.extensionDetails = {
                name,
                type,
                loading: false,
                version,
                branches: extensionBranches,
                branch: state.extensionDetails.branch || version?.currentBranchName || '',
                error: '',
            };
            render();
        } catch (error) {
            state.extensionDetails = {
                ...state.extensionDetails,
                loading: false,
                error: error.message,
            };
            render();
            throw error;
        }
    }

    async function switchExtensionBranch() {
        const details = state.extensionDetails;
        const branch = details.branch.trim();
        if (!details.name || !details.type || !branch) {
            throw new Error('请选择扩展和分支。');
        }

        state.extensionDetails.loading = true;
        render();
        try {
            await apiFetch('/api/extensions/switch', {
                body: {
                    extensionName: details.name,
                    branch,
                    global: details.type === 'global',
                },
            });
            try {
                await callLegacyBridge(BRIDGE_ACTIONS.EXTENSION_BRANCH_SWITCHED, {}, BRIDGE_TIMEOUTS.EXTENSION);
            } catch (error) {
                showToast('扩展设置同步失败，请刷新页面', error.message);
            }
            showToast('扩展分支已切换', `${details.name} → ${branch}，请刷新页面应用更新`);
            await loadExtensionDetails(details.name, details.type, { branches: true });
        } finally {
            state.extensionDetails.loading = false;
            render();
        }
    }

    return {
        getExtensionFolderName,
        canManageExtension,
        toggleExtensionInstall,
        installExtensionFromForm,
        loadExtensionDetails,
        switchExtensionBranch,
        beginExtensionOperation,
        cancelExtensionOperation,
        confirmExtensionOperation,
    };
}

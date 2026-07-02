export function createExtensionsRoute(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        uniqueValues,
        metricCard,
        pageHead,
        renderKeyValue,
        matchesQuery,
        getExtensionFolderName,
        canManageExtension,
        render,
        showToast,
        toggleExtensionInstall,
        installExtensionFromForm,
        loadExtensionDetails,
        switchExtensionBranch,
        beginExtensionOperation,
        cancelExtensionOperation,
        confirmExtensionOperation,
    } = ctx;

    function renderExtensions() {
        const matchingExtensions = state.extensions.filter(extension => matchesQuery(extension.name, extension.type));
        const systemCount = matchingExtensions.filter(extension => extension.type === 'system').length;
        const localCount = matchingExtensions.filter(extension => extension.type === 'local').length;
        const globalCount = matchingExtensions.filter(extension => extension.type === 'global').length;
        const manageableCount = matchingExtensions.filter(canManageExtension).length;
        const activeView = getExtensionView();
        const extensions = getVisibleExtensions(matchingExtensions, activeView);

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

    function setExtensionView(view) {
        state.extensionView = ['all', 'manageable', 'system', 'local', 'global'].includes(view) ? view : 'all';
        localStorage.setItem('st-modern-extension-view', state.extensionView);
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

    function renderExtensionCard(extension) {
        const name = getExtensionFolderName(extension);
        const isManageable = canManageExtension(extension);
        const title = extension.name.replace('third-party/', '');
        const detailsOpen = state.extensionDetails.name === name && state.extensionDetails.type === extension.type;
        const operationOpen = state.extensionOperation.name === name && state.extensionOperation.type === extension.type;

        return `
        <article class="resource-card extension-card">
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
                    <button class="secondary-button danger-action" type="button" data-extension-action="delete" data-extension-name="${escapeHtml(name)}" data-extension-type="${escapeHtml(extension.type)}">
                        <i class="fa-solid fa-trash"></i>
                        删除
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

    function renderExtensionInstallPanel() {
        const install = state.extensionInstall;

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">安装扩展</h2>
                    <p class="panel-subtitle">从 Git 仓库安装第三方扩展；安装后会读取 manifest.json。</p>
                </div>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>Git URL</span>
                        <input class="text-input" type="url" data-extension-install-url value="${escapeHtml(install.url)}" placeholder="https://github.com/user/extension.git" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>分支</span>
                        <input class="text-input" type="text" data-extension-install-branch value="${escapeHtml(install.branch)}" placeholder="留空使用默认分支" autocomplete="off">
                    </label>
                    ${state.me?.admin ? `
                        <label class="checkbox-card compact-checkbox">
                            <input type="checkbox" data-extension-install-global ${install.global ? 'checked' : ''}>
                            <span>安装为全局扩展</span>
                        </label>
                    ` : ''}
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-toggle-extension-install ${install.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-install-extension ${install.running ? 'disabled' : ''}>
                        <i class="fa-solid ${install.running ? 'fa-circle-notch fa-spin' : 'fa-download'}"></i>
                        ${install.running ? '安装中' : '安装扩展'}
                    </button>
                </div>
            </div>
        </section>
    `;
    }

    function renderExtensionDetailsPanel(extension) {
        const details = state.extensionDetails;
        const version = details.version || {};
        const currentHash = version.currentCommitHash ? String(version.currentCommitHash).slice(0, 12) : '未读取';
        const status = details.loading
            ? '读取中'
            : (details.error ? '读取失败' : (version.isUpToDate === false ? '有更新' : '最新'));
        const branchOptions = uniqueValues([
            details.branch,
            version.currentBranchName,
            ...details.branches.map(branch => branch.name),
        ].filter(Boolean));

        return `
        <div class="settings-form inline-form extension-detail-panel">
            <div class="panel-header compact-header">
                <div>
                    <strong>${escapeHtml(getExtensionFolderName(extension))}</strong>
                    <p class="panel-subtitle">${escapeHtml(extension.type)} · ${escapeHtml(version.remoteUrl || '未读取远端')}</p>
                </div>
                <span class="badge ${details.error || version.isUpToDate === false ? 'danger' : ''}">${escapeHtml(status)}</span>
            </div>
            ${details.error ? `<p class="danger">${escapeHtml(details.error)}</p>` : ''}
            <div class="kv-list">
                ${renderKeyValue('当前分支', version.currentBranchName || '未读取')}
                ${renderKeyValue('当前提交', currentHash)}
                ${renderKeyValue('远端', version.remoteUrl || '未配置')}
                ${renderKeyValue('分支数量', details.branches.length ? formatNumber(details.branches.length) : '未读取')}
            </div>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>目标分支</span>
                    ${branchOptions.length ? `
                        <select class="select-input" data-extension-branch>
                            ${branchOptions.map(branch => `<option value="${escapeHtml(branch)}" ${details.branch === branch ? 'selected' : ''}>${escapeHtml(branch)}</option>`).join('')}
                        </select>
                    ` : `
                        <input class="text-input" type="text" data-extension-branch value="${escapeHtml(details.branch)}" placeholder="先读取分支或输入本地分支">
                    `}
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-refresh-extension-details="${escapeHtml(details.name)}" data-extension-type="${escapeHtml(details.type)}" ${details.loading ? 'disabled' : ''}>
                    <i class="fa-solid ${details.loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                    刷新状态
                </button>
                <button class="secondary-button" type="button" data-load-extension-branches="${escapeHtml(details.name)}" data-extension-type="${escapeHtml(details.type)}" ${details.loading ? 'disabled' : ''}>
                    <i class="fa-solid ${details.loading ? 'fa-circle-notch fa-spin' : 'fa-code-branch'}"></i>
                    读取分支
                </button>
                <button class="secondary-button" type="button" data-switch-extension-branch ${details.loading || !details.branch ? 'disabled' : ''}>
                    <i class="fa-solid fa-code-compare"></i>
                    切换分支
                </button>
            </div>
        </div>
    `;
    }

    function renderExtensionOperationPanel(extension) {
        const operation = state.extensionOperation;
        const isDelete = operation.action === 'delete';
        const isMove = operation.action === 'move';
        const title = isDelete ? '删除扩展' : (isMove ? '移动扩展' : '更新扩展');
        const description = isDelete
            ? '删除会移除扩展目录。'
            : (isMove ? `将扩展移动到${extension.type === 'global' ? '本地' : '全局'}目录。` : '更新会执行 git pull。');

        return `
        <div class="settings-form inline-form ${isDelete ? 'danger-panel' : ''}">
            <div>
                <strong>${title}</strong>
                <p class="panel-subtitle">${escapeHtml(getExtensionFolderName(extension))} · ${escapeHtml(extension.type)}。${escapeHtml(description)}</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-extension-operation ${operation.running ? 'disabled' : ''}>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button ${isDelete ? 'danger-action' : ''}" type="button" data-confirm-extension-operation ${operation.running ? 'disabled' : ''}>
                    <i class="fa-solid ${operation.running ? 'fa-circle-notch fa-spin' : (isDelete ? 'fa-trash' : (isMove ? 'fa-right-left' : 'fa-download'))}"></i>
                    ${operation.running ? '处理中' : '确认'}
                </button>
            </div>
        </div>
    `;
    }

    async function handleClick(event) {
        const extensionViewButton = event.target.closest('[data-extension-view]');
        if (extensionViewButton) {
            setExtensionView(extensionViewButton.dataset.extensionView);
            render();
            return true;
        }

        if (event.target.closest('[data-toggle-extension-install]')) {
            toggleExtensionInstall();
            return;
        }

        if (event.target.closest('[data-install-extension]')) {
            try {
                await installExtensionFromForm();
            } catch (error) {
                state.errors.push({ key: 'extension-install', message: error.message });
                showToast('扩展安装失败', error.message);
                state.extensionInstall.running = false;
                render();
            }
            return;
        }

        const extensionDetailsButton = event.target.closest('[data-extension-details]');
        if (extensionDetailsButton) {
            try {
                await loadExtensionDetails(extensionDetailsButton.dataset.extensionDetails, extensionDetailsButton.dataset.extensionType);
            } catch (error) {
                state.errors.push({ key: 'extension-details', message: error.message });
                showToast('扩展状态读取失败', error.message);
            }
            return;
        }

        const refreshExtensionDetailsButton = event.target.closest('[data-refresh-extension-details]');
        if (refreshExtensionDetailsButton) {
            try {
                await loadExtensionDetails(refreshExtensionDetailsButton.dataset.refreshExtensionDetails, refreshExtensionDetailsButton.dataset.extensionType);
            } catch (error) {
                state.errors.push({ key: 'extension-details-refresh', message: error.message });
                showToast('扩展状态刷新失败', error.message);
            }
            return;
        }

        const loadExtensionBranchesButton = event.target.closest('[data-load-extension-branches]');
        if (loadExtensionBranchesButton) {
            try {
                await loadExtensionDetails(loadExtensionBranchesButton.dataset.loadExtensionBranches, loadExtensionBranchesButton.dataset.extensionType, { branches: true });
            } catch (error) {
                state.errors.push({ key: 'extension-branches', message: error.message });
                showToast('扩展分支读取失败', error.message);
            }
            return;
        }

        if (event.target.closest('[data-switch-extension-branch]')) {
            try {
                await switchExtensionBranch();
            } catch (error) {
                state.errors.push({ key: 'extension-switch', message: error.message });
                showToast('扩展分支切换失败', error.message);
                state.extensionDetails.loading = false;
                render();
            }
            return;
        }

        const extensionActionButton = event.target.closest('[data-extension-action]');
        if (extensionActionButton) {
            beginExtensionOperation(extensionActionButton.dataset.extensionName, extensionActionButton.dataset.extensionType, extensionActionButton.dataset.extensionAction);
            return;
        }

        if (event.target.closest('[data-cancel-extension-operation]')) {
            cancelExtensionOperation();
            return;
        }

        if (event.target.closest('[data-confirm-extension-operation]')) {
            try {
                await confirmExtensionOperation();
            } catch (error) {
                state.errors.push({ key: 'extension-operation', message: error.message });
                showToast('扩展操作失败', error.message);
                cancelExtensionOperation();
            }
            return;
        }


        return false;
    }

    function handleInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-url]')) {
            state.extensionInstall.url = event.target.value;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-branch]')) {
            state.extensionInstall.branch = event.target.value;
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-extension-branch]')) {
            state.extensionDetails.branch = event.target.value;
        }

        return false;
    }

    function handleChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-global]')) {
            state.extensionInstall.global = event.target.checked;
            return;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-extension-branch]')) {
            state.extensionDetails.branch = event.target.value;
            render();
            return;
        }

        return false;
    }

    return {
        render: renderExtensions,
        handleClick,
        handleInput,
        handleChange,
    };
}

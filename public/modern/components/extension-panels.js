export function createExtensionPanelComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        uniqueValues,
        renderKeyValue,
        getExtensionFolderName,
    } = ctx;

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

    return {
        renderExtensionInstallPanel,
        renderExtensionDetailsPanel,
        renderExtensionOperationPanel,
    };
}

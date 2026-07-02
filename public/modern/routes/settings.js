export function createSettingsRoute(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        renderInlineEmpty,
        renderKeyValue,
        getAssetCount,
        getChatModeLabel,
        getRequestCompressionSettings,
        render,
        showToast,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferencesFromForm,
        saveRequestCompressionFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
    } = ctx;

    function renderSettings() {
        const bundle = state.settingsBundle || {};
        const requestCompression = getRequestCompressionSettings();
        const savedSecrets = Object.values(state.secretState || {}).filter(value => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
        const snapshotCount = state.settingsSnapshots.items.length;
        const compressionEnabled = Boolean(requestCompression.enabled);
        const dataStatus = state.errors.length ? '需要处理' : '正常';
        const activeSection = getSettingsSection();

        return `
        ${pageHead('设置中心', '账户、扩展、请求压缩和页面偏好。', `
            <button class="primary-button" type="button" data-create-settings-snapshot ${state.settingsSnapshots.creating ? 'disabled' : ''}>
                <i class="fa-solid ${state.settingsSnapshots.creating ? 'fa-circle-notch fa-spin' : 'fa-camera'}"></i>
                创建快照
            </button>
            <button class="secondary-button" type="button" data-load-settings-snapshots ${state.settingsSnapshots.loading ? 'disabled' : ''}>
                <i class="fa-solid ${state.settingsSnapshots.loading ? 'fa-circle-notch fa-spin' : 'fa-clock-rotate-left'}"></i>
                设置快照
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('数据状态', dataStatus, state.errors.length ? `${formatNumber(state.errors.length)} 个读取错误` : '读取正常', 'fa-heart-pulse')}
            ${metricCard('扩展', formatNumber(state.extensions.length), bundle.enable_extensions ? '扩展系统开启' : '扩展系统关闭', 'fa-cubes')}
            ${metricCard('安全密钥', formatNumber(savedSecrets), '仅显示保存状态', 'fa-key')}
            ${metricCard('设置快照', formatNumber(snapshotCount), state.settingsSnapshots.loading ? '读取中' : '本地备份', 'fa-clock-rotate-left')}
        </div>
        ${renderSettingsTabs(activeSection)}
        ${activeSection === 'preferences' ? renderSettingsPreferencesSection(requestCompression, compressionEnabled) : ''}
        ${activeSection === 'status' ? renderSettingsStatusSection(bundle, savedSecrets, dataStatus, compressionEnabled, requestCompression) : ''}
        ${activeSection === 'snapshots' ? renderSettingsSnapshots() : ''}
        ${activeSection === 'diagnostics' ? renderSettingsDiagnosticsSection(bundle, savedSecrets, dataStatus) : ''}
    `;
    }

    function getSettingsSection() {
        return ['preferences', 'status', 'snapshots', 'diagnostics'].includes(state.settingsSection)
            ? state.settingsSection
            : 'preferences';
    }

    function setSettingsSection(section) {
        state.settingsSection = ['preferences', 'status', 'snapshots', 'diagnostics'].includes(section) ? section : 'preferences';
        localStorage.setItem('st-modern-settings-section', state.settingsSection);
    }

    function renderSettingsTabs(activeSection) {
        const tabs = [
            ['preferences', 'fa-sliders', '界面与请求'],
            ['status', 'fa-gauge-high', '账户与资源'],
            ['snapshots', 'fa-clock-rotate-left', '设置快照'],
            ['diagnostics', 'fa-shield-halved', '安全诊断'],
        ];
        return `
        <div class="segmented-control settings-tabs" role="tablist" aria-label="设置分区">
            ${tabs.map(([id, icon, label]) => `
                <button class="${activeSection === id ? 'active' : ''}" type="button" data-settings-section="${id}" aria-selected="${activeSection === id}">
                    <i class="fa-solid ${icon}"></i>
                    ${label}
                </button>
            `).join('')}
        </div>
    `;
    }

    function renderSettingsPreferencesSection(requestCompression, compressionEnabled) {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">可编辑设置</h2>
                    <p class="panel-subtitle">现代页本地偏好与 settings.json 中的请求压缩参数。</p>
                </div>
            </div>
            <div class="settings-edit-grid">
                ${renderModernPreferencesForm()}
                ${renderRequestCompressionForm(requestCompression)}
            </div>
        </section>
        <div class="grid-list settings-summary-grid">
            <article class="resource-card">
                <h2 class="card-title">现代界面</h2>
                <p class="card-meta">新版工作区本地偏好。</p>
                <div class="kv-list">
                    ${renderKeyValue('主题', state.theme)}
                    ${renderKeyValue('聊天类型', getChatModeLabel())}
                    ${renderKeyValue('聊天列表', state.chatSidebarOpen ? '展开' : '收起')}
                    ${renderKeyValue('上下文抽屉', state.inspectorOpen ? '展开' : '收起')}
                    ${renderKeyValue('入口', '/modern/')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求压缩</h2>
                <p class="card-meta">控制大请求的压缩边界。</p>
                <div class="kv-list">
                    ${renderKeyValue('启用', compressionEnabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
            </article>
        </div>
    `;
    }

    function renderSettingsStatusSection(bundle, savedSecrets, dataStatus, compressionEnabled, requestCompression) {
        return `
        <div class="grid-list">
            <article class="resource-card">
                <h2 class="card-title">用户与账户</h2>
                <p class="card-meta">当前登录与权限状态。</p>
                <div class="kv-list">
                    ${renderKeyValue('当前用户', state.me?.name || state.me?.handle || '默认用户')}
                    ${renderKeyValue('管理员', state.me?.admin ? '是' : '否')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">扩展能力</h2>
                <p class="card-meta">第三方扩展发现、安装和更新策略。</p>
                <div class="kv-list">
                    ${renderKeyValue('扩展启用', bundle.enable_extensions ? '是' : '否')}
                    ${renderKeyValue('自动更新', bundle.enable_extensions_auto_update ? '是' : '否')}
                    ${renderKeyValue('发现数量', state.extensions.length)}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求压缩</h2>
                <p class="card-meta">控制大请求的压缩边界。</p>
                <div class="kv-list">
                    ${renderKeyValue('启用', compressionEnabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">现代界面</h2>
                <p class="card-meta">新版工作区本地偏好。</p>
                <div class="kv-list">
                    ${renderKeyValue('主题', state.theme)}
                    ${renderKeyValue('聊天类型', getChatModeLabel())}
                    ${renderKeyValue('聊天列表', state.chatSidebarOpen ? '展开' : '收起')}
                    ${renderKeyValue('上下文抽屉', state.inspectorOpen ? '展开' : '收起')}
                    ${renderKeyValue('入口', '/modern/')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">资源索引</h2>
                <p class="card-meta">当前用户目录读取到的核心对象。</p>
                <div class="kv-list">
                    ${renderKeyValue('角色', formatNumber(state.characters.length))}
                    ${renderKeyValue('群聊', formatNumber(state.groups.length))}
                    ${renderKeyValue('世界书', formatNumber(state.worldbooks.length || (state.settingsBundle.world_names || []).length))}
                    ${renderKeyValue('素材', formatNumber(getAssetCount()))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求安全</h2>
                <p class="card-meta">现代页请求令牌和密钥状态。</p>
                <div class="kv-list">
                    ${renderKeyValue('CSRF', state.csrfToken ? '已获取' : '未获取')}
                    ${renderKeyValue('密钥状态', savedSecrets ? `${formatNumber(savedSecrets)} 个已保存` : '未读取到')}
                    ${renderKeyValue('错误状态', dataStatus)}
                </div>
            </article>
        </div>
    `;
    }

    function renderSettingsDiagnosticsSection(bundle, savedSecrets, dataStatus) {
        return `
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">安全与请求状态</h2>
                        <p class="panel-subtitle">新版界面只展示密钥保存状态，不暴露密钥内容。</p>
                    </div>
                </div>
                <div class="kv-list">
                    ${renderKeyValue('CSRF', state.csrfToken ? '已获取' : '未获取')}
                    ${renderKeyValue('密钥状态', savedSecrets ? `${formatNumber(savedSecrets)} 个已保存` : '未读取到')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                    ${renderKeyValue('扩展系统', bundle.enable_extensions ? '开启' : '关闭')}
                    ${renderKeyValue('错误状态', dataStatus)}
                </div>
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">读取错误</h2>
                        <p class="panel-subtitle">当前数据加载链路的错误会集中显示在这里。</p>
                    </div>
                </div>
                ${state.errors.length ? `
                    <div class="resource-list compact-list">
                        ${state.errors.map(error => `
                            <article class="resource-row">
                                <span class="avatar-fallback"><i class="fa-solid fa-triangle-exclamation"></i></span>
                                <span class="row-main">
                                    <span class="row-title">${escapeHtml(error.key)}</span>
                                    <span class="row-subtitle">${escapeHtml(error.message)}</span>
                                </span>
                            </article>
                        `).join('')}
                    </div>
                ` : renderEmptyState('fa-circle-check', '暂无错误', '当前 modern 数据读取正常。')}
            </section>
        </div>
    `;
    }

    function renderModernPreferencesForm() {
        const defaultChatSidebarOpen = localStorage.getItem('st-modern-chat-sidebar-open') === null
            ? state.chatSidebarOpen
            : localStorage.getItem('st-modern-chat-sidebar-open') === 'true';
        const defaultInspectorOpen = localStorage.getItem('st-modern-inspector-open') === null
            ? state.inspectorOpen
            : localStorage.getItem('st-modern-inspector-open') === 'true';

        return `
        <section class="form-section">
            <div>
                <h3 class="form-section-title">现代界面偏好</h3>
                <p class="panel-subtitle">保存到浏览器本地，只影响新版工作区。</p>
            </div>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>主题</span>
                    <select class="select-input" data-modern-theme>
                        <option value="light" ${state.theme === 'light' ? 'selected' : ''}>浅色</option>
                        <option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>深色</option>
                    </select>
                </label>
                <label class="field-label">
                    <span>默认聊天类型</span>
                    <select class="select-input" data-modern-chat-mode>
                        <option value="character" ${state.chatMode === 'character' ? 'selected' : ''}>角色</option>
                        <option value="group" ${state.chatMode === 'group' ? 'selected' : ''}>群聊</option>
                    </select>
                </label>
            </div>
            <div class="checkbox-grid compact-checkbox-grid">
                <label class="checkbox-card">
                    <input type="checkbox" data-modern-chat-sidebar-open ${defaultChatSidebarOpen ? 'checked' : ''}>
                    <span>默认展开聊天列表</span>
                </label>
                <label class="checkbox-card">
                    <input type="checkbox" data-modern-inspector-open ${defaultInspectorOpen ? 'checked' : ''}>
                    <span>默认展开上下文抽屉</span>
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-modern-preferences>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存界面偏好
                </button>
            </div>
        </section>
    `;
    }

    function renderRequestCompressionForm(requestCompression) {
        return `
        <section class="form-section">
            <div>
                <h3 class="form-section-title">请求压缩</h3>
                <p class="panel-subtitle">控制大请求压缩边界，保存到 settings.json。</p>
            </div>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-request-compression-enabled ${requestCompression.enabled ? 'checked' : ''}>
                <span>启用请求压缩</span>
            </label>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>最小载荷 Byte</span>
                    <input class="text-input" type="number" min="0" step="1" data-request-compression-min value="${escapeHtml(requestCompression.minPayloadSize ?? 0)}">
                </label>
                <label class="field-label">
                    <span>最大载荷 Byte</span>
                    <input class="text-input" type="number" min="0" step="1" data-request-compression-max value="${escapeHtml(requestCompression.maxPayloadSize ?? 0)}">
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-request-compression>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存请求压缩
                </button>
            </div>
        </section>
    `;
    }

    function renderSettingsSnapshots() {
        const snapshots = state.settingsSnapshots.items;
        const selectedSnapshot = state.settingsSnapshots.previewName;
        const isLoading = state.settingsSnapshots.loading;

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">设置快照</h2>
                    <p class="panel-subtitle">备份和恢复 settings.json。恢复前会要求二次确认。</p>
                </div>
                <button class="secondary-button" type="button" data-load-settings-snapshots ${isLoading ? 'disabled' : ''}>
                    <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                    刷新
                </button>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list">
                    ${snapshots.map(snapshot => renderSettingsSnapshotRow(snapshot)).join('') || renderInlineEmpty(isLoading ? '正在读取设置快照' : '暂无设置快照')}
                </div>
                <div class="backup-preview">
                    ${selectedSnapshot ? `
                        <div class="panel-header compact-header">
                            <div>
                                <h3 class="panel-title">${escapeHtml(selectedSnapshot)}</h3>
                                <p class="panel-subtitle">只读预览。恢复会替换当前 settings.json。</p>
                            </div>
                        </div>
                        <textarea readonly>${escapeHtml(state.settingsSnapshots.previewText)}</textarea>
                    ` : renderEmptyState('fa-file-code', '未选择快照', '点击“预览”查看快照内容。')}
                </div>
            </div>
        </section>
    `;
    }

    function renderSettingsSnapshotRow(snapshot) {
        const name = snapshot.name || '';
        const isConfirming = state.settingsSnapshots.restoreConfirm === name;
        const isBusy = state.settingsSnapshots.restoring && isConfirming;
        return `
        <article class="backup-row ${state.settingsSnapshots.previewName === name ? 'active' : ''}">
            <div class="row-main">
                <strong class="row-title">${escapeHtml(name)}</strong>
                <span class="row-subtitle">${escapeHtml(formatDate(snapshot.date))} · ${escapeHtml(formatBytes(snapshot.size))}</span>
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-preview-settings-snapshot="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-eye"></i>
                    预览
                </button>
                ${isConfirming ? `
                    <button class="secondary-button" type="button" data-cancel-settings-restore ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-settings-restore ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        <i class="fa-solid ${state.settingsSnapshots.restoring ? 'fa-circle-notch fa-spin' : 'fa-rotate-left'}"></i>
                        确认恢复
                    </button>
                ` : `
                    <button class="secondary-button danger-action" type="button" data-restore-settings-snapshot="${escapeHtml(name)}" ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        <i class="fa-solid fa-rotate-left"></i>
                        恢复
                    </button>
                `}
            </div>
        </article>
    `;
    }

    async function handleClick(event) {
        const settingsSectionButton = event.target.closest('[data-settings-section]');
        if (settingsSectionButton) {
            setSettingsSection(settingsSectionButton.dataset.settingsSection);
            render();
            return true;
        }

        if (event.target.closest('[data-load-settings-snapshots]')) {
            try {
                setSettingsSection('snapshots');
                await loadSettingsSnapshots({ force: true });
                render();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshots', message: error.message });
                showToast('设置快照读取失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-create-settings-snapshot]')) {
            try {
                setSettingsSection('snapshots');
                await createSettingsSnapshot();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-create', message: error.message });
                showToast('设置快照创建失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-save-modern-preferences]')) {
            saveModernPreferencesFromForm();
            return true;
        }

        if (event.target.closest('[data-save-request-compression]')) {
            try {
                await saveRequestCompressionFromForm();
            } catch (error) {
                state.errors.push({ key: 'request-compression-save', message: error.message });
                showToast('请求压缩保存失败', error.message);
                render();
            }
            return true;
        }

        const previewSettingsSnapshotButton = event.target.closest('[data-preview-settings-snapshot]');
        if (previewSettingsSnapshotButton) {
            try {
                await previewSettingsSnapshot(previewSettingsSnapshotButton.dataset.previewSettingsSnapshot);
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-preview', message: error.message });
                showToast('设置快照预览失败', error.message);
                render();
            }
            return true;
        }

        const restoreSettingsSnapshotButton = event.target.closest('[data-restore-settings-snapshot]');
        if (restoreSettingsSnapshotButton) {
            beginSettingsSnapshotRestore(restoreSettingsSnapshotButton.dataset.restoreSettingsSnapshot);
            return true;
        }

        if (event.target.closest('[data-cancel-settings-restore]')) {
            cancelSettingsSnapshotRestore();
            return true;
        }

        if (event.target.closest('[data-confirm-settings-restore]')) {
            try {
                await confirmSettingsSnapshotRestore();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-restore', message: error.message });
                showToast('设置快照恢复失败', error.message);
                render();
            }
            return true;
        }


        return false;
    }

    return {
        render: renderSettings,
        handleClick,
    };
}

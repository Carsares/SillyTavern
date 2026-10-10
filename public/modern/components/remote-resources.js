// 每页渲染的结果卡片数：避免一次搜索把数百张卡片同时塞进 DOM。
const REMOTE_RESULT_PAGE_SIZE = 24;
// 进度区每类资源站名单最多列出的名称数，超出部分以「等」收尾。
const PROGRESS_NAME_LIMIT = 6;

export function createRemoteResourceComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        loadRemoteResources,
        showToast,
        render,
    } = ctx;
    let autoLoadPending = false;
    // Stops the first-load failure from silently re-firing (and re-toasting) on every render; manual refresh still retries.
    let autoLoadFailed = false;

    function renderRemoteResources() {
        ensureRemoteResourcesLoaded();
        const remote = state.remoteResources;
        const activeTab = remote.activeTab;
        const searchableProviders = remote.providers.filter(provider => provider.supportsSearch);
        const credentialCount = remote.providers.reduce((count, provider) => count + provider.credentials.filter(credential => credential.active).length, 0);

        return `
        ${pageHead('远程资源', '跨资源站搜索、导入和记录远程角色卡、世界书、扩展与素材。', `
            <button class="secondary-button" type="button" data-refresh-remote-resources ${remote.loading ? 'disabled' : ''}>
                <i class="fa-solid ${remote.loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                刷新
            </button>
        `)}
        <div class="metrics-grid remote-resource-metrics">
            ${metricCard('资源站', remote.loading && !remote.loaded ? '—' : formatNumber(remote.providers.length), `${formatNumber(searchableProviders.length)} 个可搜索`, 'fa-globe')}
            ${metricCard('搜索结果', remote.searched ? formatNumber(remote.results.length) : '—', remote.searching ? '搜索中' : `${formatNumber(remote.total)} 条匹配`, 'fa-magnifying-glass')}
            ${metricCard('导入记录', formatNumber(remote.records.length), '本地记录', 'fa-clock-rotate-left')}
            ${metricCard('凭据', formatNumber(credentialCount), '仅显示保存状态', 'fa-key')}
        </div>
        ${renderRemoteTabs(activeTab)}
        ${activeTab === 'discover' ? renderDiscoverTab(remote, searchableProviders) : ''}
        ${activeTab === 'url' ? renderUrlTab(remote) : ''}
        ${activeTab === 'records' ? renderRecordsTab(remote) : ''}
        ${activeTab === 'accounts' ? renderAccountsTab(remote) : ''}
    `;
    }

    function renderRemoteTabs(activeTab) {
        const tabs = [
            ['discover', 'fa-compass', '发现'],
            ['url', 'fa-link', 'URL 导入'],
            ['records', 'fa-clock-rotate-left', '导入记录'],
            ['accounts', 'fa-key', '资源站账号'],
        ];
        return `
        <div class="segmented-control remote-resource-tabs" role="tablist" aria-label="远程资源分区">
            ${tabs.map(([id, icon, label]) => `
                <button class="${activeTab === id ? 'active' : ''}" type="button" data-remote-resource-tab="${id}" aria-selected="${activeTab === id}">
                    <i class="fa-solid ${icon}"></i>
                    ${label}
                </button>
            `).join('')}
        </div>
    `;
    }

    function renderDiscoverTab(remote, searchableProviders) {
        return `
        <section class="remote-search-area" aria-label="远程资源搜索">
            <div class="remote-search-grid">
                <label class="field-label">
                    <span>关键词</span>
                    <input class="text-input" type="search" data-remote-resource-query value="${escapeHtml(remote.query)}" placeholder="名称、作者、标签">
                </label>
                <label class="field-label">
                    <span>类型</span>
                    <select class="text-input" data-remote-resource-type>
                        ${renderTypeOption('', '全部', remote.resourceType)}
                        ${renderTypeOption('character', '角色卡', remote.resourceType)}
                        ${renderTypeOption('worldbook', '世界书', remote.resourceType)}
                        ${renderTypeOption('extension', '扩展', remote.resourceType)}
                        ${renderTypeOption('asset', '素材', remote.resourceType)}
                        ${renderTypeOption('preset', '预设', remote.resourceType)}
                    </select>
                </label>
                <div class="remote-search-actions">
                    <button class="primary-button remote-search-button" type="button" data-search-remote-resources ${!searchableProviders.length ? 'disabled' : ''}>
                        <i class="fa-solid fa-magnifying-glass"></i>
                        搜索
                    </button>
                    ${remote.searching ? `
                        <button class="secondary-button remote-search-button" type="button" data-cancel-remote-search>
                            <i class="fa-solid fa-circle-stop"></i>
                            取消搜索
                        </button>
                    ` : ''}
                </div>
            </div>
            <div class="remote-provider-row">
                ${searchableProviders.map(provider => {
        // A disabled provider is skipped by the backend search, so grey it out and annotate it here.
        const enabled = provider.enabled !== false;
        return `
                    <label class="check-row remote-provider-check ${enabled ? '' : 'remote-provider-disabled'}">
                        <input type="checkbox" data-remote-provider="${escapeHtml(provider.id)}" ${remote.selectedProviders.includes(provider.id) ? 'checked' : ''}>
                        <span>${escapeHtml(provider.name)}${enabled ? '' : ' · 已禁用'}</span>
                    </label>
                `;
    }).join('') || '<span class="muted">暂无可搜索资源站</span>'}
            </div>
            ${renderSearchProgress(remote)}
            ${remote.errors.length ? `<div class="remote-resource-warning"><i class="fa-solid fa-triangle-exclamation"></i>${escapeHtml(remote.errors.join('；'))}</div>` : ''}
        </section>
        ${renderRemoteResults(remote)}
    `;
    }

    // 逐站进度：已完成数 / 总数 + 已找到条数，并列出仍在等待和已失败的资源站名称。
    function renderSearchProgress(remote) {
        const progress = remote.searchProgress;
        if (!remote.searched || !progress?.providers?.length) {
            return '';
        }
        const providers = progress.providers;
        const finished = providers.filter(provider => provider.status === 'done' || provider.status === 'failed');
        const failed = providers.filter(provider => provider.status === 'failed');
        const pending = [
            ...providers.filter(provider => provider.status === 'running'),
            ...providers.filter(provider => provider.status === 'queued'),
        ];
        const cancelled = providers.filter(provider => provider.status === 'cancelled');
        const counts = `已完成 ${formatNumber(finished.length)} / ${formatNumber(providers.length)} 个资源站`;
        let icon = 'fa-circle-check';
        let summary = `${counts} · 共找到 ${formatNumber(remote.results.length)} 条`;
        if (remote.searching) {
            icon = 'fa-circle-notch fa-spin';
            summary = `${counts} · 已找到 ${formatNumber(remote.results.length)} 条`;
        } else if (progress.cancelled) {
            icon = 'fa-circle-stop';
            summary = `已取消搜索 · ${counts} · 保留 ${formatNumber(remote.results.length)} 条`;
        }

        return `
        <div class="remote-search-progress" data-remote-search-progress role="status" aria-live="polite">
            <div class="remote-search-progress-summary" data-remote-search-progress-summary>
                <i class="fa-solid ${icon}"></i>
                <span>${escapeHtml(summary)}</span>
            </div>
            ${remote.searching && pending.length ? renderProviderNameList('等待响应', pending, 'data-remote-search-pending') : ''}
            ${cancelled.length ? renderProviderNameList('未完成', cancelled, 'data-remote-search-cancelled') : ''}
            ${failed.length ? renderProviderNameList('失败', failed, 'data-remote-search-failed', 'remote-search-progress-failed') : ''}
        </div>
    `;
    }

    function renderProviderNameList(label, providers, dataAttribute, className = '') {
        const shown = providers.slice(0, PROGRESS_NAME_LIMIT).map(provider => provider.name || provider.id).join('、');
        const more = providers.length > PROGRESS_NAME_LIMIT ? ' 等' : '';
        return `<div class="remote-search-progress-detail ${className}" ${dataAttribute}>${escapeHtml(`${label}（${formatNumber(providers.length)}）：${shown}${more}`)}</div>`;
    }

    function renderRemoteResults(remote) {
        if (remote.searching && !remote.results.length) {
            return renderEmptyState('fa-circle-notch fa-spin', '正在搜索远程资源', '正在调用公开资源站接口。');
        }
        if (!remote.searched) {
            return renderEmptyState('fa-cloud-arrow-down', '尚未搜索', '选择资源站和类型后开始搜索。');
        }
        if (!remote.results.length) {
            if (remote.searchProgress?.cancelled) {
                return renderEmptyState('fa-circle-stop', '搜索已取消', '取消前没有资源站返回结果。');
            }
            return renderEmptyState('fa-magnifying-glass', '没有匹配资源', '换一个关键词或资源站。');
        }

        // 分页只影响渲染：索引仍是 results 中的绝对下标，导入 / 下载按钮的定位方式不变。
        const pageCount = Math.max(1, Math.ceil(remote.results.length / REMOTE_RESULT_PAGE_SIZE));
        const page = Math.min(Math.max(1, Number(remote.resultPage) || 1), pageCount);
        const start = (page - 1) * REMOTE_RESULT_PAGE_SIZE;
        const pageItems = remote.results.slice(start, start + REMOTE_RESULT_PAGE_SIZE);

        return `
        ${pageCount > 1 ? renderResultPager('top', page, pageCount, start, pageItems.length, remote.results.length) : ''}
        <div class="remote-result-grid">
            ${pageItems.map((item, offset) => renderRemoteCard(item, start + offset)).join('')}
        </div>
        ${pageCount > 1 ? renderResultPager('bottom', page, pageCount, start, pageItems.length, remote.results.length) : ''}
    `;
    }

    function renderResultPager(position, page, pageCount, start, count, totalCount) {
        return `
        <div class="remote-result-pager" data-remote-result-pager="${position}">
            <button class="secondary-button" type="button" data-remote-result-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
                上一页
            </button>
            <span class="badge" data-remote-result-page-badge>${formatNumber(page)} / ${formatNumber(pageCount)}</span>
            <button class="secondary-button" type="button" data-remote-result-page="${page + 1}" ${page >= pageCount ? 'disabled' : ''}>
                下一页
                <i class="fa-solid fa-chevron-right"></i>
            </button>
            <span class="muted">第 ${formatNumber(start + 1)}–${formatNumber(start + count)} 条，共 ${formatNumber(totalCount)} 条</span>
        </div>
    `;
    }

    function renderRemoteCard(item, index) {
        const operationKey = `${item.providerId}:${item.resourceType}:${item.id}`;
        const running = state.remoteResources.operation.key === operationKey && state.remoteResources.operation.running;
        const typeLabel = getTypeLabel(item.resourceType);
        const stats = Object.entries(item.stats || {}).filter(([, value]) => value !== '').slice(0, 3);
        const actionLabel = item.resourceType === 'extension' ? '安装' : item.resourceType === 'asset' ? '下载到素材' : ['character', 'worldbook', 'preset'].includes(item.resourceType) ? '导入' : '下载';
        // M6.2d：按 remoteId + providerId 匹配已有导入记录，命中则显示「已导入」徽章。
        const imported = state.remoteResources.records.some(record => record.remoteId === item.id && record.providerId === item.providerId);
        // 预设类型推断失败时，本卡片进入内联选择状态。
        const presetPromptActive = state.remoteResources.presetPrompt?.key === operationKey;

        return `
        <article class="resource-card remote-resource-card">
            <div class="remote-card-head">
                ${item.thumbnailUrl ? `<img class="remote-thumb" src="${escapeHtml(item.thumbnailUrl)}" alt="">` : `<span class="remote-thumb remote-thumb-fallback"><i class="fa-solid ${getTypeIcon(item.resourceType)}"></i></span>`}
                <div class="remote-card-title">
                    <h2>${escapeHtml(item.title)}</h2>
                    <div class="card-meta">${escapeHtml(item.providerName)} · ${escapeHtml(typeLabel)}${item.author ? ` · ${escapeHtml(item.author)}` : ''}</div>
                    ${imported ? '<span class="tag remote-imported-badge">已导入</span>' : ''}
                </div>
            </div>
            ${item.description ? `<p class="remote-description">${escapeHtml(item.description)}</p>` : ''}
            ${item.tags.length ? `<div class="tag-row">${item.tags.slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
            ${stats.length ? `<div class="remote-stat-row">${stats.map(([key, value]) => `<span>${escapeHtml(key)} ${formatNumber(value)}</span>`).join('')}</div>` : ''}
            <div class="row-actions">
                <button class="primary-button" type="button" data-import-remote-resource="${index}" ${running ? 'disabled' : ''}>
                    <i class="fa-solid ${running ? 'fa-circle-notch fa-spin' : item.resourceType === 'extension' ? 'fa-download' : 'fa-file-import'}"></i>
                    ${actionLabel}
                </button>
                ${item.capabilities?.download && ['character', 'worldbook'].includes(item.resourceType) ? `
                    <button class="secondary-button" type="button" data-download-remote-resource="${index}" ${running ? 'disabled' : ''}>
                        <i class="fa-solid fa-cloud-arrow-down"></i>
                        下载
                    </button>
                ` : ''}
                ${item.sourceUrl ? `
                    <a class="secondary-button" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        打开
                    </a>
                ` : ''}
            </div>
            ${presetPromptActive ? renderPresetTypePrompt(index) : ''}
        </article>
    `;
    }

    // 预设类型无法自动识别时的内联回退：让用户从合法 apiId 中选一个再确认导入。
    function renderPresetTypePrompt(index) {
        const options = [
            ['', '请选择类型'],
            ['openai', 'Chat Completion (OpenAI)'],
            ['textgenerationwebui', 'Text Completion'],
            ['kobold', 'KoboldAI'],
            ['koboldhorde', 'KoboldAI Horde'],
            ['novel', 'NovelAI'],
            ['instruct', '指令模板 (Instruct)'],
            ['context', '上下文模板 (Context)'],
            ['sysprompt', '系统提示词'],
            ['reasoning', '推理模板'],
        ];
        return `
        <div class="remote-preset-prompt">
            <span class="muted">无法自动识别预设类型，请选择后导入：</span>
            <div class="row-actions">
                <select class="text-input" data-preset-apiid>
                    ${options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}
                </select>
                <button class="primary-button" type="button" data-confirm-preset-import="${index}">
                    <i class="fa-solid fa-file-import"></i>
                    导入
                </button>
                <button class="secondary-button" type="button" data-cancel-preset-import>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
            </div>
        </div>
    `;
    }

    function renderUrlTab(remote) {
        return `
        <section class="remote-url-panel">
            <label class="field-label">
                <span>远程 URL</span>
                <input class="text-input" type="url" data-remote-url-import value="${escapeHtml(remote.urlImport.url)}" placeholder="https://chub.ai/characters/...">
            </label>
            <button class="primary-button" type="button" data-import-remote-url ${remote.urlImport.running ? 'disabled' : ''}>
                <i class="fa-solid ${remote.urlImport.running ? 'fa-circle-notch fa-spin' : 'fa-file-import'}"></i>
                导入
            </button>
        </section>
        <div class="remote-provider-grid">
            ${remote.providers.map(provider => renderProviderManageCard(provider)).join('')}
        </div>
    `;
    }

    function renderProviderManageCard(provider) {
        const enabled = provider.enabled !== false;
        const toggling = state.remoteResources.providerToggling === provider.id;
        return `
        <article class="resource-card remote-provider-card ${enabled ? '' : 'remote-provider-disabled'}">
            <div class="card-head">
                <div>
                    <h2 class="card-title">${escapeHtml(provider.name)}</h2>
                    <div class="card-meta">${escapeHtml(provider.authMode === 'none' ? '匿名' : provider.authMode)} · ${escapeHtml(getProviderCapabilityLabel(provider))}</div>
                </div>
                <i class="fa-solid ${provider.supportsSearch ? 'fa-magnifying-glass' : 'fa-link'}"></i>
            </div>
            <p class="remote-description">${escapeHtml(provider.description)}</p>
            <label class="check-row remote-provider-enable">
                <input type="checkbox" data-toggle-provider-enabled data-provider-id="${escapeHtml(provider.id)}" ${enabled ? 'checked' : ''} ${toggling ? 'disabled' : ''}>
                <span>${toggling ? '更新中…' : enabled ? '已启用' : '已禁用'}</span>
            </label>
        </article>
    `;
    }

    function renderRecordsTab(remote) {
        if (!remote.records.length) {
            return renderEmptyState('fa-clock-rotate-left', '暂无导入记录', '从远程资源导入或下载后会生成记录。');
        }

        return `
        <div class="remote-record-list">
            ${remote.records.map(record => `
                <article class="resource-card remote-record-card">
                    <div class="card-head">
                        <div>
                            <h2 class="card-title">${escapeHtml(record.title || record.remoteId)}</h2>
                            <div class="card-meta">${escapeHtml(record.providerName || record.providerId)} · ${escapeHtml(getTypeLabel(record.resourceType))} · ${escapeHtml(formatDate(record.importedAt))}</div>
                        </div>
                        <span class="tag">${escapeHtml(record.action || 'import')}</span>
                    </div>
                    <div class="remote-record-target">${escapeHtml(record.localType || '文件')} ${escapeHtml(record.localId || '')}</div>
                    <div class="row-actions">
                        ${record.sourceUrl ? `
                            <a class="secondary-button" href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noreferrer">
                                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                                打开
                            </a>
                        ` : ''}
                        <button class="secondary-button danger-action" type="button" data-delete-remote-record="${escapeHtml(record.id)}">
                            <i class="fa-solid fa-trash"></i>
                            删除
                        </button>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
    }

    function renderAccountsTab(remote) {
        const accountCards = remote.providers.filter(provider => provider.credentials.length).map(provider => `
            <article class="resource-card remote-account-card">
                <div class="card-head">
                    <div>
                        <h2 class="card-title">${escapeHtml(provider.name)}</h2>
                        <div class="card-meta">${escapeHtml(provider.description)}</div>
                    </div>
                    <i class="fa-solid fa-key"></i>
                </div>
                ${provider.credentials.map(credential => renderCredentialControl(provider, credential)).join('')}
            </article>
        `).join('');

        return `<div class="remote-account-grid">${accountCards || renderEmptyState('fa-key', '暂无凭据槽位', '当前资源站均可匿名访问。')}</div>`;
    }

    function renderCredentialControl(provider, credential) {
        const key = `${provider.id}:${credential.id}`;
        const saving = state.remoteResources.credentialSaving === key;
        const draft = state.remoteResources.credentialDrafts[key] || '';
        return `
        <div class="remote-credential-row">
            <label class="field-label">
                <span>${escapeHtml(credential.label)} ${credential.active ? `<span class="muted">(${escapeHtml(credential.maskedValue)})</span>` : ''}</span>
                <input class="text-input" type="${escapeHtml(credential.inputType || 'password')}" data-remote-credential-provider="${escapeHtml(provider.id)}" data-remote-credential-id="${escapeHtml(credential.id)}" value="${escapeHtml(draft)}" placeholder="${escapeHtml(credential.description || '')}">
            </label>
            <div class="row-actions">
                <button class="primary-button" type="button" data-save-remote-credential data-provider-id="${escapeHtml(provider.id)}" data-credential-id="${escapeHtml(credential.id)}" ${saving ? 'disabled' : ''}>
                    <i class="fa-solid ${saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}"></i>
                    保存
                </button>
                ${credential.active ? `
                    <button class="secondary-button danger-action" type="button" data-delete-remote-credential data-provider-id="${escapeHtml(provider.id)}" data-credential-id="${escapeHtml(credential.id)}" ${saving ? 'disabled' : ''}>
                        <i class="fa-solid fa-trash"></i>
                        删除
                    </button>
                ` : ''}
            </div>
        </div>
    `;
    }

    function renderTypeOption(value, label, selected) {
        return `<option value="${escapeHtml(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }

    function ensureRemoteResourcesLoaded() {
        if (state.remoteResources.loaded || state.remoteResources.loading || autoLoadPending || autoLoadFailed) {
            return;
        }

        autoLoadPending = true;
        window.setTimeout(async () => {
            try {
                await loadRemoteResources();
            } catch (error) {
                // Surface the first-load failure instead of failing silently, and stop auto-retrying every render
                autoLoadFailed = true;
                state.errors.push({ key: 'remote-resources', message: error.message });
                showToast('远程资源读取失败', error.message);
                render();
            } finally {
                autoLoadPending = false;
            }
        }, 0);
    }

    return {
        renderRemoteResources,
    };
}

function getTypeLabel(type) {
    return {
        character: '角色卡',
        worldbook: '世界书',
        extension: '扩展',
        asset: '素材',
        preset: '预设',
    }[type] || '资源';
}

function getTypeIcon(type) {
    return {
        character: 'fa-address-card',
        worldbook: 'fa-book-open',
        extension: 'fa-cubes',
        asset: 'fa-folder-tree',
        preset: 'fa-sliders',
    }[type] || 'fa-cloud-arrow-down';
}

function getProviderCapabilityLabel(provider) {
    const capabilities = [];
    if (provider.supportsSearch) {
        capabilities.push('支持搜索');
    }
    if (provider.supportsUrlImport) {
        capabilities.push('URL 导入');
    }
    if (provider.supportsDownload) {
        capabilities.push('下载');
    }
    if (provider.supportsInstall) {
        capabilities.push('安装');
    }
    return capabilities.length ? capabilities.join(' / ') : '预留';
}

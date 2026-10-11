import { renderSwitchResult } from './chat-connection-chip.js';
import {
    describeProfile,
    getSwitchBlocker,
    getSwitcherState,
    readConnectionManager,
} from '../actions/connection-profiles.js';

export function createApiProfileComponents(ctx) {
    const {
        state,
        escapeHtml,
        renderKeyValue,
    } = ctx;

    // 由当前设置整理出的聊天补全 / 文本补全来源概览（只读）。真正保存的连接档案在 renderConnectionProfilesSection
    function renderApiProfilesSection(profiles) {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接来源概览</h2>
                    <p class="panel-subtitle">按当前设置整理出的聊天补全和文本补全连接，敏感字段已省略。</p>
                </div>
            </div>
            <div class="grid-list">
                ${profiles.map(profile => renderApiProfileCard(profile)).join('')}
            </div>
        </section>
    `;
    }

    function renderConnectionProfileCard(profile, { selectedProfile, deleteConfirmId, blocker }) {
        const view = describeProfile(profile);
        const current = view.id === selectedProfile;
        const confirmingDelete = deleteConfirmId === view.id;
        const idAttribute = escapeHtml(view.id);
        return `
        <article class="resource-card connection-profile-card${current ? ' is-current' : ''}" data-connection-profile-card="${idAttribute}">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(view.name)}</h3>
                    <div class="card-meta">${escapeHtml(view.modeLabel)}</div>
                </div>
                ${current ? '<span class="badge active">当前</span>' : ''}
            </div>
            <div class="kv-list">
                ${renderKeyValue('来源', view.sourceLabel, { emptyText: '未记录' })}
                ${renderKeyValue('模型', view.model, { emptyText: '未记录' })}
                ${renderKeyValue('预设', view.preset, { emptyText: '未记录' })}
                ${renderKeyValue('地址', view.endpoint, { emptyText: '未记录' })}
                ${view.proxy ? renderKeyValue('代理预设', view.proxy) : ''}
                ${view.excludedLabels.length ? renderKeyValue('不包含', view.excludedLabels.join('、')) : ''}
            </div>
            ${confirmingDelete ? `
                <div class="connection-profile-confirm" role="group" aria-label="确认删除档案">
                    <span>确定删除“${escapeHtml(view.name)}”？不会改动当前的连接设置。</span>
                    <div class="connection-profile-actions">
                        <button class="secondary-button compact-button danger-action" type="button" data-api-connection-profile-delete-confirm="${idAttribute}">删除</button>
                        <button class="secondary-button compact-button" type="button" data-api-connection-profile-delete-cancel>取消</button>
                    </div>
                </div>
            ` : `
                <div class="connection-profile-actions">
                    <button class="primary-button compact-button" type="button" data-api-connection-profile-apply="${idAttribute}" ${blocker ? 'disabled' : ''} title="${escapeHtml(blocker || (current ? '重新应用这个档案' : '应用这个档案'))}">
                        <i class="fa-solid fa-plug-circle-check" aria-hidden="true"></i>
                        ${current ? '重新应用' : '应用'}
                    </button>
                    <button class="secondary-button compact-button danger-action" type="button" data-api-connection-profile-delete="${idAttribute}">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        删除
                    </button>
                </div>
            `}
        </article>
    `;
    }

    function renderConnectionProfileCreateForm(switcher, blocker) {
        return `
        <form class="inline-form connection-profile-create" data-connection-profile-create-form novalidate>
            <label class="field-label">
                <span>档案名称</span>
                <input class="text-input" type="text" maxlength="80" autocomplete="off" data-api-connection-create-name value="${escapeHtml(switcher.createName)}" ${switcher.error ? 'aria-invalid="true" aria-describedby="api-connection-create-error"' : ''}>
            </label>
            ${switcher.error ? `<p class="field-error" id="api-connection-create-error" role="alert" data-api-connection-error>${escapeHtml(switcher.error)}</p>` : ''}
            <p class="panel-subtitle">记录当前的来源、模型、预设、地址、代理和停止字符串等设置；密钥只记录当前启用的是哪一个，不会写入明文。</p>
            <div class="connection-profile-actions">
                <button class="primary-button compact-button" type="submit" ${blocker ? 'disabled' : ''}>保存档案</button>
                <button class="secondary-button compact-button" type="button" data-api-connection-create-cancel>取消</button>
            </div>
        </form>
    `;
    }

    // 旧版连接管理扩展保存的真实档案：列表、应用、删除和从当前连接创建。聊天输入框旁的连接标签读写同一份数据
    function renderConnectionProfilesSection() {
        const switcher = getSwitcherState(state);
        const { profiles, selectedProfile } = readConnectionManager(state.settings || {});
        const blocker = getSwitchBlocker(state);
        const createButton = `
            <button class="secondary-button" type="button" data-api-connection-profile-create-open ${switcher.busy ? 'disabled' : ''}>
                <i class="fa-solid fa-plus" aria-hidden="true"></i>
                从当前连接创建档案
            </button>
        `;
        return `
        <section class="panel section-panel connection-profiles" data-connection-profiles>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接档案</h2>
                    <p class="panel-subtitle">把来源、模型、预设、地址等存成一组，在这里或聊天输入框旁一键切换，档案与生成引擎共用。预设、代理按名称精确匹配，找不到的项会跳过并说明原因，不会改用名称相近的项。</p>
                </div>
                <div class="panel-actions">
                    ${switcher.createOpen ? '' : createButton}
                </div>
            </div>
            ${switcher.createOpen ? renderConnectionProfileCreateForm(switcher, switcher.busy ? '正在切换连接' : '') : ''}
            ${blocker ? `<p class="connection-profiles-note" role="status">${escapeHtml(blocker)}，暂时不能应用档案。</p>` : ''}
            ${profiles.length ? `
                <div class="grid-list">
                    ${profiles.map(profile => renderConnectionProfileCard(profile, { selectedProfile, deleteConfirmId: switcher.deleteConfirmId, blocker })).join('')}
                </div>
            ` : `
                <div class="connection-profiles-empty">
                    <i class="fa-solid fa-plug-circle-plus" aria-hidden="true"></i>
                    <strong>还没有连接档案</strong>
                    <span>先在上面配好并保存一个连接，再点“从当前连接创建档案”，之后可以随时切换。</span>
                </div>
            `}
            ${switcher.lastResult ? renderSwitchResult(switcher.lastResult, { dismissAttribute: 'data-api-connection-result-dismiss' }) : ''}
        </section>
    `;
    }

    function renderApiRawDataPanel(provider) {
        return `
        <details class="panel section-panel raw-data-panel">
            <summary>
                <span>
                    <strong>原始字段</strong>
                    <em>用于排查连接选择，默认折叠。</em>
                </span>
                <i class="fa-solid fa-chevron-down"></i>
            </summary>
            <div class="grid-list">
                <article class="resource-card">
                    <h3 class="card-title">主配置</h3>
                    <div class="kv-list">
                        ${renderKeyValue('main_api', provider.api)}
                        ${renderKeyValue('chat_completion_source', provider.chatSource || '未设置')}
                        ${renderKeyValue('model', provider.model || '未设置')}
                        ${renderKeyValue('preset', provider.preset || '未设置')}
                    </div>
                </article>
                <article class="resource-card">
                    <h3 class="card-title">安全</h3>
                    <div class="kv-list">
                        ${renderKeyValue('secrets exposure', state.secrets?.allowKeysExposure ? '允许显示' : '不允许显示')}
                        ${renderKeyValue('csrf token', state.csrfToken ? '已获取' : '未获取')}
                        ${renderKeyValue('accounts', state.settingsBundle.enable_accounts ? '开启' : '关闭')}
                        ${renderKeyValue('extensions', state.settingsBundle.enable_extensions ? '开启' : '关闭')}
                    </div>
                </article>
            </div>
        </details>
    `;
    }

    function renderApiProfileCard(profile) {
        // 主连接 summarizes whichever sub-profile is active, so it must not compete for the 当前/备用 signal
        const isSummary = profile.title === '主连接';
        const badgeLabel = isSummary ? '汇总' : (profile.active ? '当前' : '备用');
        const badgeActive = !isSummary && profile.active;
        // Only an inactive type card gets a switch button; on the active card it would be a silent no-op
        const canSelect = profile.mainApi && !isSummary && !profile.active;
        return `
        <article class="resource-card api-profile-card">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(profile.title)}</h3>
                    <div class="card-meta">${escapeHtml(profile.kind)}</div>
                </div>
                <span class="badge${badgeActive ? ' active' : ''}">${badgeLabel}</span>
            </div>
            <div class="kv-list">
                ${renderKeyValue('来源', profile.source, { emptyText: '未配置' })}
                ${renderKeyValue('模型', profile.model, { emptyText: '未配置' })}
                ${renderKeyValue('预设', profile.preset, { emptyText: '未配置' })}
                ${renderKeyValue('端点', profile.endpoint, { emptyText: '未配置' })}
            </div>
            ${canSelect ? `
                <button class="secondary-button" type="button" data-api-profile-main="${escapeHtml(profile.mainApi)}">
                    <i class="fa-solid fa-arrow-right"></i>
                    查看${escapeHtml(profile.title)}
                </button>
            ` : ''}
        </article>
    `;
    }

    return {
        renderApiProfilesSection,
        renderConnectionProfilesSection,
        renderApiRawDataPanel,
    };
}
